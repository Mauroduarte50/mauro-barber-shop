"use server";

import { and, asc, desc, eq, gte, ilike, like, lt, sql } from "drizzle-orm";
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
  services,
  users,
  type Appointment,
  type Client,
  type Service,
} from "@/db/schema";
import { createSession, destroySession, getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { getAppSettings, saveSettings, getDefaultBarber, getSettingsMap } from "@/lib/settings";
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
  todayStrInTz,
  isValidEmail,
  isValidPhone,
} from "@/lib/utils";
import { audit } from "@/lib/system";

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

export async function ensureAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/* ================= SHARED HELPERS ================= */

async function getContext() {
  const barber = await getDefaultBarber();
  if (!barber) throw new Error("No hay barberos configurados");
  const settings = await getAppSettings(barber.id);
  return { barber, settings };
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

export async function getOverview() {
  const { barber, settings } = await getContext();
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
    todayAppointments: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString() })),
    unreadCount: unread.length,
    tz: settings.timezone,
  };
}

export async function getCalendarData(ref: string, spanDays: number) {
  const { barber, settings } = await getContext();
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
    appointments: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString() })),
    workHours: hours.map((h) => ({ weekday: h.weekday, startMin: h.startMin, endMin: h.endMin })),
    blocks: blocks.map((b) => ({ date: b.date, startMin: b.startMin, endMin: b.endMin, reason: b.reason })),
  };
}

/* ================= APPOINTMENTS ================= */

export async function listAppointments(filter?: { status?: string; date?: string; q?: string }) {
  const { barber, settings } = await getContext();
  const conds = [eq(appointments.barberId, barber.id)];
  if (filter?.status) conds.push(eq(appointments.status, filter.status));
  if (filter?.date) {
    const start = localMidnight(filter.date, settings.timezone);
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
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
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

export async function createAppointment(input: AppointmentInput) {
  const user = await ensureAdmin();
  const { barber, settings } = await getContext();
  const name = sanitizeText(input.clientName, 100);
  const phone = sanitizeText(input.clientPhone, 30);
  const email = sanitizeText(input.clientEmail ?? "", 120);
  if (!name || !phone) return { ok: false as const, error: "Nombre y teléfono son obligatorios." };
  if (!isValidPhone(phone)) return { ok: false as const, error: "Teléfono inválido." };
  if (email && !isValidEmail(email)) return { ok: false as const, error: "Correo inválido." };

  let service: Service | null = null;
  if (input.serviceId) {
    const rows = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);
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
  const user = await ensureAdmin();
  const { barber } = await getContext();
  const rows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  const appt = rows[0];
  if (!appt) return { ok: false as const, error: "Cita no encontrada." };

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
      .where(eq(clients.id, appt.clientId));
    const pay = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.appointmentId, id))
      .limit(1);
    if (!pay.length && appt.price > 0) {
      await db.insert(payments).values({
        appointmentId: id,
        barberId: barber.id,
        amount: appt.price,
        method: appt.paymentMethod || "efectivo",
      });
    }
    await db.update(appointments).set({ paid: true }).where(eq(appointments.id, id));
  }
  if (status === "cancelada") {
    await db
      .insert(notifications)
      .values({ barberId: barber.id, type: "cancelled", title: "Cita cancelada", body: `${appt.code} fue cancelada por ${user.name}.` })
      .catch(() => {});
  }
  await audit(user.id, user.name, "change_status", `Cambió estado de ${appt.code} a ${status}`);
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function cancelAppointment(id: string) {
  const user = await ensureAdmin();
  const rows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  if (!rows.length) return { ok: false as const, error: "No encontrada." };
  const appt = rows[0];
  await db
    .update(appointments)
    .set({ status: "cancelada", cancelledAt: new Date(), cancelledBy: user.name, updatedAt: new Date() })
    .where(eq(appointments.id, id));
  await audit(user.id, user.name, "cancel_appointment", `Canceló cita ${appt.code}`);
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ================= CLIENTS ================= */

export async function listClients(q?: string) {
  const { barber } = await getContext();
  const conds = [eq(clients.barberId, barber.id)];
  if (q) {
    conds.push(ilike(clients.name, `%${q}%`));
  }
  return db
    .select()
    .from(clients)
    .where(and(...conds))
    .orderBy(desc(clients.lastVisit))
    .limit(200);
}

export async function getClientDetail(id: string) {
  const { barber, settings } = await getContext();
  const rows = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.barberId, barber.id))).limit(1);
  const client = rows[0];
  if (!client) return null;
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
    .where(and(eq(appointments.clientId, id), eq(appointments.barberId, barber.id)))
    .orderBy(desc(appointments.startTime))
    .limit(100);
  return {
    client: { ...client, firstVisit: client.firstVisit?.toISOString() ?? null, lastVisit: client.lastVisit?.toISOString() ?? null },
    history: history.map((h) => ({ ...h, startTime: h.startTime.toISOString() })),
    tz: settings.timezone,
  };
}

export async function updateClient(input: { id: string; name: string; phone: string; email?: string; notes?: string }) {
  const user = await ensureAdmin();
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

export async function listServices() {
  const { barber } = await getContext();
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
  const user = await ensureAdmin();
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
  const user = await ensureAdmin();
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
  const user = await ensureAdmin();
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
  const user = await ensureAdmin();
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
  const user = await ensureAdmin();
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
  const user = await ensureAdmin();
  const { barber } = await getContext();
  await db.delete(blockedSlots).where(and(eq(blockedSlots.id, id), eq(blockedSlots.barberId, barber.id)));
  await audit(user.id, user.name, "unblock_slot", `Desbloqueó horario ${id}`);
  revalidatePath("/admin/blocks");
  return { ok: true as const };
}

/* ================= INCOME ================= */

export async function getIncomeData() {
  const { barber, settings } = await getContext();
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
  const user = await ensureAdmin();
  const { barber } = await getContext();
  const rows = await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  const appt = rows[0];
  if (!appt) return { ok: false as const, error: "Cita no encontrada." };
  await db.insert(payments).values({ appointmentId, barberId: barber.id, amount: appt.price, method });
  await db.update(appointments).set({ paid: true, paymentMethod: method }).where(eq(appointments.id, appointmentId));
  await audit(user.id, user.name, "record_payment", `Registró pago de ${appt.code} (${method})`);
  revalidatePath("/admin/income");
  return { ok: true as const };
}

export async function setPaymentMethod(appointmentId: string, method: string) {
  await ensureAdmin();
  await db.update(appointments).set({ paymentMethod: method }).where(eq(appointments.id, appointmentId));
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ================= STATS ================= */

export async function getStatsData() {
  const { barber, settings } = await getContext();
  const stats = await computeStats(barber.id, settings.timezone);
  return { stats, tz: settings.timezone, currency: settings.currency };
}

/* ================= NOTIFICATIONS ================= */

export async function listNotifications() {
  const { barber } = await getContext();
  return db.select().from(notifications).where(eq(notifications.barberId, barber.id)).orderBy(desc(notifications.createdAt)).limit(100);
}

export async function markAllNotificationsRead() {
  await ensureAdmin();
  const { barber } = await getContext();
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.barberId, barber.id), eq(notifications.read, false)));
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ================= SETTINGS ================= */

export async function getSettingsData() {
  const { barber } = await getContext();
  return getSettingsMap(barber.id);
}

export async function saveSettingsData(input: Record<string, string>) {
  const user = await ensureAdmin();
  const { barber } = await getContext();
  await saveSettings(barber.id, input);
  await audit(user.id, user.name, "update_settings", "Actualizó configuración general");
  revalidatePath("/admin/settings");
  return { ok: true as const };
}

export async function changePassword(current: string, next: string) {
  const user = await ensureAdmin();
  if (next.length < 6) return { ok: false as const, error: "La nueva contraseña debe tener al menos 6 caracteres." };
  if (!(await verifyPassword(current, user.passwordHash))) return { ok: false as const, error: "Contraseña actual incorrecta." };
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id));
  return { ok: true as const };
}

/* ================= AUDIT ================= */

export async function getAuditLogs(limit = 50) {
  await ensureAdmin();
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}
