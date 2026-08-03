"use server";

import { and, asc, desc, eq, gte, ilike, inArray, like, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  appointments,
  auditLogs,
  barbers,
  blockedSlots,
  breaks,
  businessHours,
  clients,
  notifications,
  payments,
  pushSubscriptions,
  services,
  users,
  type Appointment,
  type Client,
  type Service,
} from "@/db/schema";
import { createSession, destroySession, getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import {
  getAppSettings,
  getSettingsMap,
  resolveOwnBarber,
  getGlobalSettingsMap,
  saveGlobalSettings,
  saveBarberSettings,
  getBarberById,
} from "@/lib/settings";
import { createAppointmentTx, computeStats, getDayAvailability, getPayments } from "@/lib/availability";
import {
  addDaysStr,
  fmtDateShort,
  isoWeekdayOf,
  localMidnight,
  minutesToLabel,
  money,
  sanitizeText,
  slotToDate,
  slugify,
  todayStrInTz,
  isValidEmail,
  isValidPhone,
} from "@/lib/utils";
import { audit, notify } from "@/lib/system";

/* ================= AUTH ================= */

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = sanitizeText(formData.get("email"), 100).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const row = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row.length || !(await verifyPassword(password, row[0].passwordHash))) {
    return { error: "Correo o contraseña incorrectos." };
  }
  await createSession(row[0].id);
  await audit(row[0].id, row[0].name, "login", "Inicio de sesión");
  redirect("/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Admin-only actions (team management, general settings, danger zone, audit log). */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/admin");
  return user;
}

export async function getMyRole() {
  const user = await requireUser();
  return { role: user.role, name: user.name };
}

/* ================= SHARED HELPERS ================= */

/**
 * Which barber a mutation/read targets. A `barbero` always gets their own
 * barber, no matter what `requestedBarberId` says — that value only ever
 * comes from an admin's UI selection, and is never trusted from a barbero's
 * request. An admin can target any real barber by id; anything else
 * (missing, "all", an id that doesn't exist) falls back to their own linked
 * barber, or the default barber if they don't have one.
 */
async function resolveTargetBarber(user: Awaited<ReturnType<typeof requireUser>>, requestedBarberId?: string | null) {
  if (user.role === "admin" && requestedBarberId && requestedBarberId !== "all") {
    const chosen = await getBarberById(requestedBarberId);
    if (chosen) return chosen;
  }
  return resolveOwnBarber(user);
}

async function getContext(requestedBarberId?: string | null) {
  const user = await requireUser();
  const barber = await resolveTargetBarber(user, requestedBarberId);
  if (!barber) throw new Error("No hay barberos configurados");
  const settings = await getAppSettings(barber.id);
  return { user, barber, settings };
}

/** True only when an admin has explicitly asked for the combined, all-barbers view. */
function isAllScope(user: { role: string }, requestedBarberId?: string | null) {
  return user.role === "admin" && requestedBarberId === "all";
}

/**
 * Can this user act on a row that belongs to `targetBarberId`? Admins can
 * always manage any barber's data (their current view filter is a display
 * convenience, not a permission boundary) — a barbero only ever their own.
 */
async function ownsBarber(user: Awaited<ReturnType<typeof requireUser>>, targetBarberId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const own = await resolveOwnBarber(user);
  return !!own && own.id === targetBarberId;
}

async function listActiveBarbersForScope() {
  const rows = await db.select().from(barbers).where(eq(barbers.active, true)).orderBy(asc(barbers.name));
  return rows.length ? rows : [];
}

function toApptJSON(a: Appointment) {
  return {
    id: a.id,
    code: a.code,
    serviceName: a.serviceName,
    price: a.price,
    durationMin: a.durationMin,
    startTime: a.startTime.toISOString(),
    endTime: a.endTime.toISOString(),
    status: a.status,
    notes: a.notes,
    createdBy: a.createdBy,
    clientId: a.clientId,
    serviceId: a.serviceId,
    paid: a.paid,
    paymentMethod: a.paymentMethod,
    cancelledAt: a.cancelledAt ? a.cancelledAt.toISOString() : null,
    cancelledBy: a.cancelledBy,
  };
}

/* ================= DASHBOARD / CALENDAR ================= */

/** Sums per-barber stats into one combined view — used by the admin's "todos los barberos" scope. */
function mergeStats(list: Awaited<ReturnType<typeof computeStats>>[]) {
  const today = { total: 0, confirmadas: 0, pendientes: 0, en_espera: 0, canceladas: 0, ingresos: 0 };
  const week = { total: 0, ingresos: 0 };
  const month = { total: 0, ingresos: 0 };
  let cancellations = 0, noShows = 0, newClients = 0, recurringClients = 0, totalClients = 0;
  const revenueByDay = new Map<string, { label: string; total: number }>();
  const serviceCount = new Map<string, number>();
  const hourCount = new Map<string, number>();

  for (const s of list) {
    today.total += s.today.total;
    today.confirmadas += s.today.confirmadas;
    today.pendientes += s.today.pendientes;
    today.en_espera += s.today.en_espera;
    today.canceladas += s.today.canceladas;
    today.ingresos += s.today.ingresos;
    week.total += s.week.total;
    week.ingresos += s.week.ingresos;
    month.total += s.month.total;
    month.ingresos += s.month.ingresos;
    cancellations += s.cancellations;
    noShows += s.noShows;
    newClients += s.newClients;
    recurringClients += s.recurringClients;
    totalClients += s.totalClients;
    for (const d of s.revenueByDay) {
      const cur = revenueByDay.get(d.date) ?? { label: d.label, total: 0 };
      cur.total += d.total;
      revenueByDay.set(d.date, cur);
    }
    for (const [name, count] of s.topServices) serviceCount.set(name, (serviceCount.get(name) ?? 0) + count);
    for (const [hour, count] of s.topHours) hourCount.set(hour, (hourCount.get(hour) ?? 0) + count);
  }

  return {
    today,
    week,
    month,
    revenueByDay: [...revenueByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v })),
    topServices: [...serviceCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) as [string, number][],
    topHours: [...hourCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) as [string, number][],
    cancellations,
    noShows,
    newClients,
    recurringClients,
    totalClients,
  };
}

export async function getOverview(requestedBarberId?: string) {
  const user = await requireUser();

  if (isAllScope(user, requestedBarberId)) {
    const activeBarbers = await listActiveBarbersForScope();
    if (!activeBarbers.length) throw new Error("No hay barberos configurados");
    const barberIds = activeBarbers.map((b) => b.id);
    const tz = (await getAppSettings(activeBarbers[0].id)).timezone;
    const stats = mergeStats(await Promise.all(activeBarbers.map((b) => computeStats(b.id, tz))));
    const today = todayStrInTz(tz);
    const start = localMidnight(today, tz);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const rows = await db
      .select({
        id: appointments.id,
        code: appointments.code,
        serviceName: appointments.serviceName,
        price: appointments.price,
        durationMin: appointments.durationMin,
        startTime: appointments.startTime,
        status: appointments.status,
        clientName: clients.name,
        clientPhone: clients.phone,
        barberName: barbers.name,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(barbers, eq(appointments.barberId, barbers.id))
      .where(and(inArray(appointments.barberId, barberIds), gte(appointments.startTime, start), lt(appointments.startTime, end)))
      .orderBy(asc(appointments.startTime));
    const unread = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(inArray(notifications.barberId, barberIds), eq(notifications.read, false)));
    return {
      stats,
      todayAppointments: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString() })),
      unreadCount: unread.length,
      tz,
    };
  }

  const { barber, settings } = await getContext(requestedBarberId);
  const stats = await computeStats(barber.id, settings.timezone);
  const today = todayStrInTz(settings.timezone);
  const start = localMidnight(today, settings.timezone);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const rows = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      serviceName: appointments.serviceName,
      price: appointments.price,
      durationMin: appointments.durationMin,
      startTime: appointments.startTime,
      status: appointments.status,
      clientName: clients.name,
      clientPhone: clients.phone,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .where(and(eq(appointments.barberId, barber.id), gte(appointments.startTime, start), lt(appointments.startTime, end)))
    .orderBy(asc(appointments.startTime));
  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.barberId, barber.id), eq(notifications.read, false)));
  return {
    stats,
    todayAppointments: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString(), barberName: undefined as string | undefined })),
    unreadCount: unread.length,
    tz: settings.timezone,
  };
}

export async function getCalendarData(ref: string, spanDays: number, requestedBarberId?: string) {
  const user = await requireUser();

  if (isAllScope(user, requestedBarberId)) {
    const activeBarbers = await listActiveBarbersForScope();
    if (!activeBarbers.length) throw new Error("No hay barberos configurados");
    const barberIds = activeBarbers.map((b) => b.id);
    const tz = (await getAppSettings(activeBarbers[0].id)).timezone;
    const start = localMidnight(ref, tz);
    const end = new Date(start.getTime() + spanDays * 24 * 3600 * 1000);
    const rows = await db
      .select({
        id: appointments.id,
        code: appointments.code,
        serviceName: appointments.serviceName,
        price: appointments.price,
        durationMin: appointments.durationMin,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        status: appointments.status,
        clientName: clients.name,
        clientPhone: clients.phone,
        barberName: barbers.name,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(barbers, eq(appointments.barberId, barbers.id))
      .where(and(inArray(appointments.barberId, barberIds), gte(appointments.startTime, start), lt(appointments.startTime, end)))
      .orderBy(asc(appointments.startTime));
    // Working hours/blocks aren't merged across barbers in combined view (they can legitimately differ) — only appointments are.
    return {
      tz,
      start: start.toISOString(),
      end: end.toISOString(),
      offsetMin: Math.round((Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)) - 1, Number(ref.slice(8, 10))) - start.getTime()) / 60000),
      gapMin: 0,
      appointments: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString() })),
      workHours: [] as { weekday: number; startMin: number; endMin: number }[],
      blocks: [] as { date: string; startMin: number; endMin: number; reason: string | null }[],
    };
  }

  const { barber, settings } = await getContext(requestedBarberId);
  const tz = settings.timezone;
  const start = localMidnight(ref, tz);
  const end = new Date(start.getTime() + spanDays * 24 * 3600 * 1000);
  const rows = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      serviceName: appointments.serviceName,
      price: appointments.price,
      durationMin: appointments.durationMin,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      clientName: clients.name,
      clientPhone: clients.phone,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .where(and(eq(appointments.barberId, barber.id), gte(appointments.startTime, start), lt(appointments.startTime, end)))
    .orderBy(asc(appointments.startTime));
  const hours = await db.select().from(businessHours).where(eq(businessHours.barberId, barber.id));
  const blocks = await db
    .select()
    .from(blockedSlots)
    .where(and(eq(blockedSlots.barberId, barber.id), gte(blockedSlots.date, ref), lt(blockedSlots.date, fmtDateShort(new Date(end.getTime() - 1), tz))));
  return {
    tz,
    start: start.toISOString(),
    end: end.toISOString(),
    offsetMin: Math.round((Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)) - 1, Number(ref.slice(8, 10))) - start.getTime()) / 60000),
    gapMin: settings.gapMin,
    appointments: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(), barberName: undefined as string | undefined })),
    workHours: hours.map((h) => ({ weekday: h.weekday, startMin: h.startMin, endMin: h.endMin })),
    blocks: blocks.map((b) => ({ date: b.date, startMin: b.startMin, endMin: b.endMin, reason: b.reason })),
  };
}

/* ================= APPOINTMENTS ================= */

export async function listAppointments(filter?: { status?: string; date?: string; q?: string }, requestedBarberId?: string) {
  const user = await requireUser();
  const all = isAllScope(user, requestedBarberId);

  let barberCond;
  let tz = "America/Bogota";
  if (all) {
    const activeBarbers = await listActiveBarbersForScope();
    barberCond = inArray(appointments.barberId, activeBarbers.map((b) => b.id));
    if (activeBarbers.length) tz = (await getAppSettings(activeBarbers[0].id)).timezone;
  } else {
    const { barber, settings } = await getContext(requestedBarberId);
    barberCond = eq(appointments.barberId, barber.id);
    tz = settings.timezone;
  }

  const conds = [barberCond];
  if (filter?.status) conds.push(eq(appointments.status, filter.status));
  if (filter?.date) {
    const start = localMidnight(filter.date, tz);
    conds.push(gte(appointments.startTime, start), lt(appointments.startTime, new Date(start.getTime() + 24 * 3600 * 1000)));
  }
  const rows = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      serviceName: appointments.serviceName,
      price: appointments.price,
      durationMin: appointments.durationMin,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      notes: appointments.notes,
      createdBy: appointments.createdBy,
      paid: appointments.paid,
      paymentMethod: appointments.paymentMethod,
      clientId: clients.id,
      clientName: clients.name,
      clientPhone: clients.phone,
      clientEmail: clients.email,
      barberName: barbers.name,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .innerJoin(barbers, eq(appointments.barberId, barbers.id))
    .where(and(...conds))
    .orderBy(desc(appointments.startTime))
    .limit(200);
  const withIso = rows.map((r) => ({ ...r, startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString() }));
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    return withIso.filter(
      (r) => r.clientName.toLowerCase().includes(q) || r.clientPhone.includes(q) || r.code.toLowerCase().includes(q),
    );
  }
  return withIso;
}

export interface AppointmentInput {
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceId?: string;
  date: string;
  time: string; // "09:00"
  notes?: string;
}

export async function createAppointment(input: AppointmentInput, requestedBarberId?: string) {
  const user = await requireUser();
  const { barber, settings } = await getContext(requestedBarberId);
  const name = sanitizeText(input.clientName, 100);
  const phone = sanitizeText(input.clientPhone, 30);
  const email = sanitizeText(input.clientEmail ?? "", 120);
  if (!name || !phone) return { ok: false as const, error: "Nombre y teléfono son obligatorios." };
  if (!isValidPhone(phone)) return { ok: false as const, error: "Teléfono inválido." };
  if (email && !isValidEmail(email)) return { ok: false as const, error: "Correo inválido." };

  let service: Service | null = null;
  if (input.serviceId) {
    const rows = await db
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.barberId, barber.id)))
      .limit(1);
    service = rows[0] ?? null;
  }
  const serviceName = service?.name ?? "Cita manual";
  const price = service?.price ?? 0;
  const duration = service?.durationMin ?? 30;

  const [y, m, d] = input.time.split(":").map(Number);
  const startMin = y * 60 + m;

  const day = await getDayAvailability(barber.id, input.date, duration, {
    tz: settings.timezone,
    gapMin: settings.gapMin,
    slotStep: settings.slotStep,
    minAdvanceMin: 0,
    maxAdvanceDays: settings.maxAdvanceDays,
  });
  const slot = day.slots.find((s) => s.startMin === startMin);
  if (!day.working || !slot || slot.status === "occupied" || slot.status === "blocked") {
    return { ok: false as const, error: "Ese horario no está disponible." };
  }

  const result = await createAppointmentTx({
    barberId: barber.id,
    clientName: name,
    clientPhone: phone,
    clientEmail: email || undefined,
    serviceId: service?.id ?? null,
    serviceName,
    price,
    durationMin: duration,
    dateStr: input.date,
    startMin,
    notes: sanitizeText(input.notes ?? "", 500) || undefined,
    createdBy: "barbero",
    status: "pendiente",
    opts: {
      tz: settings.timezone,
      gapMin: settings.gapMin,
      slotStep: settings.slotStep,
      minAdvanceMin: 0,
      maxAdvanceDays: settings.maxAdvanceDays,
    },
  });
  if (!result.ok) return result;
  await audit(user.id, user.name, "create_appointment", `Creó cita ${result.appointment.code}`);
  revalidatePath("/admin");
  return { ok: true as const, code: result.appointment.code };
}

export async function setAppointmentStatus(id: string, status: string) {
  const user = await requireUser();
  const rows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  const appt = rows[0];
  if (!appt || !(await ownsBarber(user, appt.barberId))) return { ok: false as const, error: "Cita no encontrada." };
  const barberId = appt.barberId;

  await db
    .update(appointments)
    .set({
      status,
      updatedAt: new Date(),
      cancelledAt: status === "cancelada" ? new Date() : appt.cancelledAt,
      cancelledBy: status === "cancelada" ? user.name : appt.cancelledBy,
    })
    .where(eq(appointments.id, id));

  if (status === "atendida") {
    await db
      .update(clients)
      .set({
        totalVisits: sql`${clients.totalVisits} + 1`,
        totalSpent: sql`${clients.totalSpent} + ${appt.price}`,
        lastVisit: new Date(),
      })
      .where(and(eq(clients.id, appt.clientId), eq(clients.barberId, barberId)));
    const pay = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.appointmentId, id))
      .limit(1);
    if (!pay.length && appt.price > 0) {
      await db.insert(payments).values({
        appointmentId: id,
        barberId,
        amount: appt.price,
        method: appt.paymentMethod || "efectivo",
      });
    }
    await db.update(appointments).set({ paid: true }).where(eq(appointments.id, id));
  }
  if (status === "cancelada") {
    await notify(barberId, "cancelled", "Cita cancelada", `${appt.code} fue cancelada por ${user.name}.`);
  }
  await audit(user.id, user.name, "change_status", `Cambió estado de ${appt.code} a ${status}`);
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function cancelAppointment(id: string) {
  const user = await requireUser();
  const rows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  const appt = rows[0];
  if (!appt || !(await ownsBarber(user, appt.barberId))) return { ok: false as const, error: "No encontrada." };
  await db
    .update(appointments)
    .set({ status: "cancelada", cancelledAt: new Date(), cancelledBy: user.name, updatedAt: new Date() })
    .where(eq(appointments.id, id));
  await notify(appt.barberId, "cancelled", "Cita cancelada", `${appt.code} fue cancelada por ${user.name}.`);
  await audit(user.id, user.name, "cancel_appointment", `Canceló cita ${appt.code}`);
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ================= CLIENTS ================= */

export async function listClients(q?: string, requestedBarberId?: string) {
  const user = await requireUser();
  const all = isAllScope(user, requestedBarberId);
  let barberCond;
  if (all) {
    const activeBarbers = await listActiveBarbersForScope();
    barberCond = inArray(clients.barberId, activeBarbers.map((b) => b.id));
  } else {
    const { barber } = await getContext(requestedBarberId);
    barberCond = eq(clients.barberId, barber.id);
  }
  const conds = [barberCond];
  if (q) conds.push(ilike(clients.name, `%${q}%`));
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phone,
      email: clients.email,
      notes: clients.notes,
      totalVisits: clients.totalVisits,
      totalSpent: clients.totalSpent,
      firstVisit: clients.firstVisit,
      lastVisit: clients.lastVisit,
      barberName: barbers.name,
    })
    .from(clients)
    .innerJoin(barbers, eq(clients.barberId, barbers.id))
    .where(and(...conds))
    .orderBy(desc(clients.lastVisit))
    .limit(200);
  return rows;
}

export async function getClientDetail(id: string) {
  const user = await requireUser();
  const rows = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  const client = rows[0];
  if (!client || !(await ownsBarber(user, client.barberId))) return null;
  const settings = await getAppSettings(client.barberId);
  const history = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      serviceName: appointments.serviceName,
      price: appointments.price,
      startTime: appointments.startTime,
      status: appointments.status,
    })
    .from(appointments)
    .where(and(eq(appointments.clientId, id), eq(appointments.barberId, client.barberId)))
    .orderBy(desc(appointments.startTime))
    .limit(100);
  return {
    client: { ...client, firstVisit: client.firstVisit?.toISOString() ?? null, lastVisit: client.lastVisit?.toISOString() ?? null },
    history: history.map((h) => ({ ...h, startTime: h.startTime.toISOString() })),
    tz: settings.timezone,
  };
}

export async function updateClient(input: { id: string; name: string; phone: string; email?: string; notes?: string }) {
  const user = await requireUser();
  const rows = await db.select({ barberId: clients.barberId }).from(clients).where(eq(clients.id, input.id)).limit(1);
  if (!rows.length || !(await ownsBarber(user, rows[0].barberId))) return { ok: false as const, error: "Cliente no encontrado." };
  await db
    .update(clients)
    .set({
      name: sanitizeText(input.name, 100),
      phone: sanitizeText(input.phone, 30),
      email: sanitizeText(input.email ?? "", 120) || null,
      notes: sanitizeText(input.notes ?? "", 500) || null,
    })
    .where(eq(clients.id, input.id));
  await audit(user.id, user.name, "update_client", `Actualizó cliente ${input.id}`);
  revalidatePath("/admin/clients");
  return { ok: true as const };
}

/* ================= SERVICES ================= */

export async function listServices(requestedBarberId?: string) {
  const { barber } = await getContext(requestedBarberId);
  return db.select().from(services).where(eq(services.barberId, barber.id)).orderBy(asc(services.sort));
}

export async function saveService(input: {
  id?: string;
  name: string;
  description?: string;
  price: number;
  durationMin: number;
  active: boolean;
}) {
  const user = await requireUser();
  const { barber } = await getContext();
  const name = sanitizeText(input.name, 100);
  const price = Math.max(0, Math.round(Number(input.price) || 0));
  const duration = Math.max(5, Math.round(Number(input.durationMin) || 30));
  if (!name) return { ok: false as const, error: "El nombre es obligatorio." };
  const values = {
    name,
    description: sanitizeText(input.description ?? "", 300) || null,
    price,
    durationMin: duration,
    active: !!input.active,
  };
  if (input.id) {
    await db.update(services).set(values).where(and(eq(services.id, input.id), eq(services.barberId, barber.id)));
    await audit(user.id, user.name, "update_service", `Actualizó servicio ${name} ($${price}, ${duration}min)`);
  } else {
    const [svc] = await db.insert(services).values({ ...values, barberId: barber.id }).returning({ id: services.id });
    await audit(user.id, user.name, "create_service", `Creó servicio ${name} ($${price}, ${duration}min) #${svc.id}`);
  }
  revalidatePath("/admin/services");
  return { ok: true as const };
}

export async function deleteService(id: string) {
  const user = await requireUser();
  const { barber } = await getContext();
  await db.delete(services).where(and(eq(services.id, id), eq(services.barberId, barber.id)));
  await audit(user.id, user.name, "delete_service", `Eliminó servicio ${id}`);
  revalidatePath("/admin/services");
  return { ok: true as const };
}

/* ================= SCHEDULE (hours + breaks) ================= */

export async function getSchedule() {
  const { barber } = await getContext();
  const hours = await db.select().from(businessHours).where(eq(businessHours.barberId, barber.id)).orderBy(asc(businessHours.weekday));
  const brks = await db.select().from(breaks).where(eq(breaks.barberId, barber.id)).orderBy(asc(breaks.weekday));
  return {
    hours: hours.map((h) => ({ weekday: h.weekday, startMin: h.startMin, endMin: h.endMin, id: h.id })),
    breaks: brks.map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin, label: b.label, id: b.id })),
  };
}

export async function saveBusinessHours(weekday: number, blocks: { startMin: number; endMin: number }[]) {
  const user = await requireUser();
  const { barber } = await getContext();
  await db.delete(businessHours).where(and(eq(businessHours.barberId, barber.id), eq(businessHours.weekday, weekday)));
  for (const b of blocks) {
    if (b.endMin > b.startMin) {
      await db.insert(businessHours).values({ barberId: barber.id, weekday, startMin: b.startMin, endMin: b.endMin });
    }
  }
  await audit(user.id, user.name, "update_schedule", `Actualizó horario del día ${weekday}`);
  revalidatePath("/admin/schedule");
  return { ok: true as const };
}

export async function saveBreaks(weekday: number, ranges: { startMin: number; endMin: number; label?: string }[]) {
  const user = await requireUser();
  const { barber } = await getContext();
  await db.delete(breaks).where(and(eq(breaks.barberId, barber.id), eq(breaks.weekday, weekday)));
  for (const r of ranges) {
    if (r.endMin > r.startMin) {
      await db.insert(breaks).values({ barberId: barber.id, weekday, startMin: r.startMin, endMin: r.endMin, label: r.label || null });
    }
  }
  await audit(user.id, user.name, "update_breaks", `Actualizó descansos del día ${weekday}`);
  revalidatePath("/admin/schedule");
  return { ok: true as const };
}

/* ================= BLOCKED SLOTS ================= */

export async function listBlocks() {
  const { barber } = await getContext();
  return db.select().from(blockedSlots).where(eq(blockedSlots.barberId, barber.id)).orderBy(desc(blockedSlots.date));
}

export async function createBlock(input: { date: string; startMin: number; endMin: number; reason?: string; allDay?: boolean }) {
  const user = await requireUser();
  const { barber } = await getContext();
  await db.insert(blockedSlots).values({
    barberId: barber.id,
    date: input.date,
    startMin: input.startMin,
    endMin: input.endMin,
    reason: sanitizeText(input.reason ?? "", 200) || null,
    allDay: !!input.allDay,
  });
  await audit(user.id, user.name, "block_slot", `Bloqueó ${input.date} ${minutesToLabel(input.startMin)}-${minutesToLabel(input.endMin)}`);
  revalidatePath("/admin/blocks");
  return { ok: true as const };
}

export async function deleteBlock(id: string) {
  const user = await requireUser();
  const { barber } = await getContext();
  await db.delete(blockedSlots).where(and(eq(blockedSlots.id, id), eq(blockedSlots.barberId, barber.id)));
  await audit(user.id, user.name, "unblock_slot", `Desbloqueó horario ${id}`);
  revalidatePath("/admin/blocks");
  return { ok: true as const };
}

/* ================= INCOME ================= */

export async function getIncomeData(requestedBarberId?: string) {
  const user = await requireUser();

  if (isAllScope(user, requestedBarberId)) {
    const activeBarbers = await listActiveBarbersForScope();
    if (!activeBarbers.length) throw new Error("No hay barberos configurados");
    const barberIds = activeBarbers.map((b) => b.id);
    const tz = (await getAppSettings(activeBarbers[0].id)).timezone;
    const perBarberPayments = await Promise.all(activeBarbers.map((b) => getPayments(b.id)));
    const payments = activeBarbers
      .flatMap((b, i) => perBarberPayments[i].map((p) => ({ ...p, barberName: b.name })))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const attendedUnpaid = await db
      .select({
        id: appointments.id,
        code: appointments.code,
        clientName: clients.name,
        serviceName: appointments.serviceName,
        price: appointments.price,
        startTime: appointments.startTime,
        paymentMethod: appointments.paymentMethod,
        barberName: barbers.name,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(barbers, eq(appointments.barberId, barbers.id))
      .where(and(inArray(appointments.barberId, barberIds), eq(appointments.status, "atendida"), eq(appointments.paid, false)))
      .orderBy(asc(appointments.startTime));
    return {
      tz,
      payments: payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), startTime: p.startTime.toISOString() })),
      attendedUnpaid: attendedUnpaid.map((a) => ({ ...a, startTime: a.startTime.toISOString() })),
    };
  }

  const { barber, settings } = await getContext(requestedBarberId);
  const payments = await getPayments(barber.id);
  const attendedUnpaid = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      clientName: clients.name,
      serviceName: appointments.serviceName,
      price: appointments.price,
      startTime: appointments.startTime,
      paymentMethod: appointments.paymentMethod,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .where(and(eq(appointments.barberId, barber.id), eq(appointments.status, "atendida"), eq(appointments.paid, false)))
    .orderBy(asc(appointments.startTime));
  return {
    tz: settings.timezone,
    payments: payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), startTime: p.startTime.toISOString() })),
    attendedUnpaid: attendedUnpaid.map((a) => ({ ...a, startTime: a.startTime.toISOString() })),
  };
}

export async function recordPayment(appointmentId: string, method: string) {
  const user = await requireUser();
  const rows = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  const appt = rows[0];
  if (!appt || !(await ownsBarber(user, appt.barberId))) return { ok: false as const, error: "Cita no encontrada." };
  await db.insert(payments).values({ appointmentId, barberId: appt.barberId, amount: appt.price, method });
  await db.update(appointments).set({ paid: true, paymentMethod: method }).where(eq(appointments.id, appointmentId));
  await audit(user.id, user.name, "record_payment", `Registró pago de ${appt.code} (${method})`);
  revalidatePath("/admin/income");
  return { ok: true as const };
}

export async function setPaymentMethod(appointmentId: string, method: string) {
  const user = await requireUser();
  const rows = await db.select({ barberId: appointments.barberId }).from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!rows.length || !(await ownsBarber(user, rows[0].barberId))) return { ok: false as const, error: "Cita no encontrada." };
  const result = await db
    .update(appointments)
    .set({ paymentMethod: method })
    .where(eq(appointments.id, appointmentId))
    .returning({ id: appointments.id });
  if (!result.length) return { ok: false as const, error: "Cita no encontrada." };
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ================= STATS ================= */

export async function getStatsData(requestedBarberId?: string) {
  const user = await requireUser();

  if (isAllScope(user, requestedBarberId)) {
    const activeBarbers = await listActiveBarbersForScope();
    if (!activeBarbers.length) throw new Error("No hay barberos configurados");
    const tz = (await getAppSettings(activeBarbers[0].id)).timezone;
    const stats = mergeStats(await Promise.all(activeBarbers.map((b) => computeStats(b.id, tz))));
    return { stats, tz, currency: "COP" };
  }

  const { barber, settings } = await getContext(requestedBarberId);
  const stats = await computeStats(barber.id, settings.timezone);
  return { stats, tz: settings.timezone, currency: settings.currency };
}

/* ================= NOTIFICATIONS ================= */

export async function listNotifications() {
  const { barber } = await getContext();
  return db.select().from(notifications).where(eq(notifications.barberId, barber.id)).orderBy(desc(notifications.createdAt)).limit(100);
}

export async function markAllNotificationsRead() {
  await requireUser();
  const { barber } = await getContext();
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.barberId, barber.id), eq(notifications.read, false)));
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ================= PUSH SUBSCRIPTIONS (Web Push) ================= */

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function savePushSubscription(sub: PushSubscriptionInput) {
  const user = await requireUser();
  const { barber } = await getContext();
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { ok: false as const, error: "Suscripción inválida." };
  }
  await db
    .insert(pushSubscriptions)
    .values({ barberId: barber.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { barberId: barber.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  await audit(user.id, user.name, "push_subscribe", "Activó notificaciones push en este dispositivo");
  return { ok: true as const };
}

export async function deletePushSubscription(endpoint: string) {
  const { barber } = await getContext();
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.barberId, barber.id)));
  return { ok: true as const };
}

export async function getPushSubscriptionStatus(endpoint: string) {
  const { barber } = await getContext();
  if (!endpoint) return { subscribed: false as const };
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.barberId, barber.id)))
    .limit(1);
  return { subscribed: rows.length > 0 };
}

/* ================= SETTINGS ================= */

/** Barber's own name and business name — used to personalize client-facing messages. */
export async function getBrandingInfo() {
  const { barber, settings } = await getContext();
  return { barberName: barber.name, businessName: settings.businessName };
}

export async function updateBarberName(name: string) {
  const user = await requireUser();
  const { barber } = await getContext();
  const clean = sanitizeText(name, 100);
  if (!clean) return { ok: false as const, error: "El nombre no puede estar vacío." };
  await db.update(barbers).set({ name: clean }).where(eq(barbers.id, barber.id));
  await audit(user.id, user.name, "update_settings", "Actualizó el nombre del barbero");
  revalidatePath("/admin/settings");
  revalidatePath("/");
  return { ok: true as const };
}

/** Shared business identity (name, WhatsApp, address…) — admin-only, one shop. */
export async function getGeneralSettingsData() {
  await requireAdmin();
  return getGlobalSettingsMap();
}

export async function saveGeneralSettings(input: Record<string, string>) {
  const user = await requireAdmin();
  await saveGlobalSettings(input);
  await audit(user.id, user.name, "update_settings", "Actualizó configuración general del negocio");
  revalidatePath("/admin/settings");
  revalidatePath("/");
  return { ok: true as const };
}

/** This barber's own booking rules — every role edits only their own. */
export async function getBarberSettingsData() {
  const { barber } = await getContext();
  return getSettingsMap(barber.id);
}

export async function saveBarberSettingsData(input: Record<string, string>) {
  const user = await requireUser();
  const { barber } = await getContext();
  await saveBarberSettings(barber.id, input);
  await audit(user.id, user.name, "update_settings", "Actualizó su configuración de reservas");
  revalidatePath("/admin/settings");
  return { ok: true as const };
}

export async function changePassword(current: string, next: string) {
  const user = await requireUser();
  if (next.length < 6) return { ok: false as const, error: "La nueva contraseña debe tener al menos 6 caracteres." };
  if (!(await verifyPassword(current, user.passwordHash))) return { ok: false as const, error: "Contraseña actual incorrecta." };
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id));
  return { ok: true as const };
}

/* ================= FACTORY RESET (danger zone) ================= */

const RESET_CONFIRM_WORD = "ELIMINAR";

/**
 * Wipes all operational data (appointments, clients, notifications,
 * services, business hours, breaks, blocked slots, payments, push
 * subscriptions) and logs the admin out, leaving the system as if freshly
 * installed. Deliberately preserves `users` (login), `barbers` (identity —
 * name/slug/id), `settings` (business config), and `audit_logs` (history,
 * including this very action) — those are never touched.
 *
 * Admin-only: wipes every barber's operational data at once, by design —
 * this stays global and unscoped even with multiple barbers.
 */
export async function factoryReset(confirmText: string) {
  const user = await requireAdmin();

  if (confirmText !== RESET_CONFIRM_WORD) {
    return { ok: false as const, error: `Debes escribir "${RESET_CONFIRM_WORD}" exactamente para confirmar.` };
  }

  // Basic guard against a repeated/duplicated request (double submit, retry
  // after a slow response) firing the wipe twice: reject if this admin
  // already started a reset in the last 30 seconds. audit_logs is never
  // cleared by the reset itself, so this check — and the record it reads —
  // both survive regardless of outcome.
  const recent = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, user.id),
        eq(auditLogs.action, "factory_reset_initiated"),
        gte(auditLogs.createdAt, new Date(Date.now() - 30_000)),
      ),
    )
    .limit(1);
  if (recent.length) {
    return { ok: false as const, error: "Ya se inició un reseteo hace unos segundos. Espera un momento antes de intentar de nuevo." };
  }

  // Logged BEFORE and outside the destructive transaction below, so this
  // specific record — who requested a full reset and when — survives even
  // if the deletion fails partway and rolls back.
  await audit(
    user.id,
    user.name,
    "factory_reset_initiated",
    "Inició un reseteo total: borra citas, clientes, servicios, horarios, descansos, bloqueos, ingresos, notificaciones y suscripciones push. Conserva la cuenta de administrador, el registro del barbero y la configuración del negocio.",
  );

  try {
    await db.transaction(async (tx) => {
      // Children before parents (appointments.clientId is ON DELETE
      // RESTRICT, so clients can't go first).
      await tx.delete(payments);
      await tx.delete(appointments);
      await tx.delete(clients);
      await tx.delete(notifications);
      await tx.delete(services);
      await tx.delete(businessHours);
      await tx.delete(breaks);
      await tx.delete(blockedSlots);
      await tx.delete(pushSubscriptions);
      await tx.insert(auditLogs).values({
        userId: user.id,
        userName: user.name,
        action: "factory_reset_completed",
        details: "Reseteo total completado con éxito.",
      });
    });
  } catch (e) {
    console.error("factoryReset error", e);
    await audit(
      user.id,
      user.name,
      "factory_reset_failed",
      `El reseteo falló y se revirtió por completo (sin cambios): ${e instanceof Error ? e.message : "error desconocido"}`,
    );
    return { ok: false as const, error: "El reseteo falló y no se realizó ningún cambio. Intenta de nuevo." };
  }

  await destroySession();
  return { ok: true as const };
}

/* ================= TEAM (admin-only) ================= */

export async function listBarbers() {
  await requireAdmin();
  const rows = await db
    .select({
      id: barbers.id,
      name: barbers.name,
      phone: barbers.phone,
      active: barbers.active,
      createdAt: barbers.createdAt,
      email: users.email,
      role: users.role,
    })
    .from(barbers)
    .leftJoin(users, eq(users.barberId, barbers.id))
    .orderBy(asc(barbers.name));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

async function assertUniqueBarberEmail(email: string) {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return existing.length === 0;
}

async function uniqueSlugFor(name: string) {
  const base = slugify(name) || "barbero";
  let slug = base;
  let n = 2;
  while ((await db.select({ id: barbers.id }).from(barbers).where(eq(barbers.slug, slug)).limit(1)).length) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export async function createBarberAccount(input: { name: string; phone?: string; email: string; password: string }) {
  const admin = await requireAdmin();
  const name = sanitizeText(input.name, 100);
  const phone = sanitizeText(input.phone ?? "", 30);
  const email = sanitizeText(input.email, 150).toLowerCase();
  if (!name) return { ok: false as const, error: "El nombre es obligatorio." };
  if (!email || !isValidEmail(email)) return { ok: false as const, error: "Correo inválido." };
  if (phone && !isValidPhone(phone)) return { ok: false as const, error: "Teléfono inválido." };
  if (input.password.length < 6) return { ok: false as const, error: "La contraseña debe tener al menos 6 caracteres." };
  if (!(await assertUniqueBarberEmail(email))) return { ok: false as const, error: "Ya existe una cuenta con ese correo." };

  const slug = await uniqueSlugFor(name);
  const passwordHash = await hashPassword(input.password);
  const barber = await db.transaction(async (tx) => {
    const [b] = await tx.insert(barbers).values({ name, slug, phone: phone || null, active: true }).returning();
    await tx.insert(users).values({ name, email, passwordHash, role: "barbero", barberId: b.id });
    return b;
  });
  await audit(admin.id, admin.name, "create_barber", `Creó al barbero ${name} (${email})`);
  revalidatePath("/admin/team");
  return { ok: true as const, barberId: barber.id };
}

export async function updateBarberProfile(input: { barberId: string; name: string; phone?: string }) {
  const admin = await requireAdmin();
  const name = sanitizeText(input.name, 100);
  const phone = sanitizeText(input.phone ?? "", 30);
  if (!name) return { ok: false as const, error: "El nombre es obligatorio." };
  if (phone && !isValidPhone(phone)) return { ok: false as const, error: "Teléfono inválido." };
  await db.update(barbers).set({ name, phone: phone || null }).where(eq(barbers.id, input.barberId));
  await db.update(users).set({ name }).where(eq(users.barberId, input.barberId));
  await audit(admin.id, admin.name, "update_barber", `Actualizó datos del barbero ${input.barberId}`);
  revalidatePath("/admin/team");
  revalidatePath("/");
  return { ok: true as const };
}

export async function setBarberActive(barberId: string, active: boolean) {
  const admin = await requireAdmin();
  await db.update(barbers).set({ active }).where(eq(barbers.id, barberId));
  await audit(admin.id, admin.name, active ? "activate_barber" : "deactivate_barber", `${active ? "Activó" : "Desactivó"} al barbero ${barberId}`);
  revalidatePath("/admin/team");
  revalidatePath("/");
  return { ok: true as const };
}

export async function resetBarberPassword(barberId: string, newPassword: string) {
  const admin = await requireAdmin();
  if (newPassword.length < 6) return { ok: false as const, error: "La contraseña debe tener al menos 6 caracteres." };
  const passwordHash = await hashPassword(newPassword);
  const result = await db.update(users).set({ passwordHash }).where(eq(users.barberId, barberId)).returning({ id: users.id });
  if (!result.length) return { ok: false as const, error: "Este barbero no tiene una cuenta de acceso." };
  await audit(admin.id, admin.name, "reset_barber_password", `Restableció la contraseña del barbero ${barberId}`);
  return { ok: true as const };
}

/* ================= AUDIT ================= */

export async function getAuditLogs(limit = 50) {
  await requireAdmin();
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}
