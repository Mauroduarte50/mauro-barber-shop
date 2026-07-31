import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  blockedSlots,
  breaks,
  businessHours,
  clients,
  notifications,
  payments,
  type Appointment,
} from "@/db/schema";
import {
  addDaysStr,
  DAY_NAMES,
  isoWeekdayOf,
  localMidnight,
  minutesToLabel,
  nowMinutesInTz,
  slotToDate,
  todayStrInTz,
} from "@/lib/utils";

export interface AvailabilityOptions {
  tz: string;
  gapMin: number;
  slotStep: number;
  minAdvanceMin: number;
  maxAdvanceDays: number;
}

export type SlotStatus = "available" | "occupied" | "blocked" | "past";

export interface SlotInfo {
  startMin: number;
  endMin: number;
  label: string;
  status: SlotStatus;
}

export interface DayInfo {
  date: string;
  weekday: number;
  weekdayLabel: string;
  working: boolean;
  reason: string; // "past" | "max_advance" | "closed" | "blocked" | ""
  slots: SlotInfo[];
  availableCount: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Computes the availability grid for one local day for a barber.
 * The definitive validation is re-done inside a DB transaction on booking.
 */
export async function getDayAvailability(
  barberId: string,
  dateStr: string,
  durationMin: number,
  opts: AvailabilityOptions,
  excludeAppointmentId?: string,
): Promise<DayInfo> {
  const tz = opts.tz;
  const today = todayStrInTz(tz);
  const weekday = isoWeekdayOf(dateStr, tz);

  if (dateStr < today) {
    return { date: dateStr, weekday, weekdayLabel: DAY_NAMES[weekday], working: false, reason: "past", slots: [], availableCount: 0 };
  }
  if (dateStr > addDaysStr(today, opts.maxAdvanceDays)) {
    return { date: dateStr, weekday, weekdayLabel: DAY_NAMES[weekday], working: false, reason: "max_advance", slots: [], availableCount: 0 };
  }

  const [hours, dayBreaks, dayBlocks] = await Promise.all([
    db.select().from(businessHours).where(and(eq(businessHours.barberId, barberId), eq(businessHours.weekday, weekday))),
    db.select().from(breaks).where(and(eq(breaks.barberId, barberId), eq(breaks.weekday, weekday))),
    db.select().from(blockedSlots).where(and(eq(blockedSlots.barberId, barberId), eq(blockedSlots.date, dateStr))),
  ]);

  const blocks = hours.sort((a, b) => a.startMin - b.startMin);
  if (!blocks.length) {
    return { date: dateStr, weekday, weekdayLabel: DAY_NAMES[weekday], working: false, reason: "closed", slots: [], availableCount: 0 };
  }
  if (dayBlocks.some((b) => b.allDay)) {
    return { date: dateStr, weekday, weekdayLabel: DAY_NAMES[weekday], working: false, reason: "blocked", slots: [], availableCount: 0 };
  }

  const dayStartUtc = localMidnight(dateStr, tz);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3600 * 1000);

  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.barberId, barberId),
        gte(appointments.startTime, dayStartUtc),
        lt(appointments.startTime, dayEndUtc),
        sql`${appointments.status} NOT IN ('cancelada','no_asistio')`,
      ),
    );

  const appts = excludeAppointmentId ? rows.filter((a) => a.id !== excludeAppointmentId) : rows;

  const occupied = appts.map((a) => ({
    startMin: (a.startTime.getTime() - dayStartUtc.getTime()) / 60000,
    endMin: (a.endTime.getTime() - dayStartUtc.getTime()) / 60000 + opts.gapMin,
  }));

  const dayStartMin = Math.min(...blocks.map((b) => b.startMin));
  const dayEndMin = Math.max(...blocks.map((b) => b.endMin));
  const nowMin = nowMinutesInTz(tz);

  const slots: SlotInfo[] = [];
  for (let m = dayStartMin; m + durationMin <= dayEndMin; m += opts.slotStep) {
    const end = m + durationMin;
    const inBlock = blocks.some((b) => m >= b.startMin && end <= b.endMin);
    if (!inBlock) continue;
    const inBreak = dayBreaks.some((b) => overlaps(m, end, b.startMin, b.endMin));
    if (inBreak) continue;
    const inBlocked = dayBlocks.some((b) => overlaps(m, end, b.startMin, b.endMin));
    const busy = occupied.some((o) => overlaps(m, end, o.startMin, o.endMin));
    let status: SlotStatus;
    if (inBlocked) status = "blocked";
    else if (busy) status = "occupied";
    else if (dateStr === today && m < nowMin + opts.minAdvanceMin) status = "past";
    else status = "available";
    slots.push({ startMin: m, endMin: end, label: minutesToLabel(m), status });
  }

  return {
    date: dateStr,
    weekday,
    weekdayLabel: DAY_NAMES[weekday],
    working: true,
    reason: "",
    slots,
    availableCount: slots.filter((s) => s.status === "available").length,
  };
}

/** Minimal per-day summary used by the booking date picker. */
export async function getDaySummary(
  barberId: string,
  dateStr: string,
  opts: AvailabilityOptions,
): Promise<{ date: string; working: boolean; reason: string; count: number }> {
  const info = await getDayAvailability(barberId, dateStr, 30, opts);
  return { date: dateStr, working: info.working, reason: info.reason, count: info.availableCount };
}

/* ---------------- transaction-safe conflict check + creation ---------------- */

export interface NewAppointmentInput {
  barberId: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceId: string | null;
  serviceName: string;
  price: number;
  durationMin: number;
  dateStr: string;
  startMin: number;
  notes?: string;
  createdBy: "cliente" | "barbero";
  status: string;
  opts: AvailabilityOptions;
}

/**
 * Creates an appointment inside a transaction guarded by an advisory lock
 * scoped to (barber, day) so two simultaneous requests cannot double-book.
 */
export async function createAppointmentTx(
  input: NewAppointmentInput,
): Promise<{ ok: true; appointment: Appointment } | { ok: false; error: string }> {
  const tz = input.opts.tz;
  const dayStartUtc = localMidnight(input.dateStr, tz);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3600 * 1000);
  const lockKey = `barber:${input.barberId}:${input.dateStr}`;

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

      // Re-check overlap under the lock (authoritative).
      const rows = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.barberId, input.barberId),
            gte(appointments.startTime, dayStartUtc),
            lt(appointments.startTime, dayEndUtc),
            sql`${appointments.status} NOT IN ('cancelada','no_asistio')`,
          ),
        );
      const start = input.startMin;
      const end = start + input.durationMin;
      for (const a of rows) {
        const aStart = (a.startTime.getTime() - dayStartUtc.getTime()) / 60000;
        const aEnd = (a.endTime.getTime() - dayStartUtc.getTime()) / 60000 + input.opts.gapMin;
        if (overlaps(start, end, aStart, aEnd)) {
          return {
            ok: false as const,
            error: "Ese horario acaba de ser reservado por otra persona. Por favor elige otro.",
          };
        }
      }

      // Client upsert by (barber, phone).
      const existing = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.barberId, input.barberId), eq(clients.phone, input.clientPhone)))
        .limit(1);
      let clientId: string;
      if (existing.length) {
        clientId = existing[0].id;
        await tx
          .update(clients)
          .set({ name: input.clientName, email: input.clientEmail || existing[0].email })
          .where(eq(clients.id, clientId));
      } else {
        const [ins] = await tx
          .insert(clients)
          .values({
            barberId: input.barberId,
            name: input.clientName,
            phone: input.clientPhone,
            email: input.clientEmail || null,
            firstVisit: new Date(),
          })
          .returning({ id: clients.id });
        clientId = ins.id;
      }

      // Unique code: BAR-YYYYMMDD-XXXX
      const prefix = `BAR-${input.dateStr.replace(/-/g, "")}`;
      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await tx.execute(sql`select (count(*)::int + 1) as c from appointments where code like ${prefix + "-%"}`);
        const c = Number((res.rows[0] as { c: number }).c);
        code = `${prefix}-${String(c).padStart(4, "0")}`;
        try {
          const [appt] = await tx
            .insert(appointments)
            .values({
              code,
              barberId: input.barberId,
              clientId,
              serviceId: input.serviceId,
              serviceName: input.serviceName,
              price: input.price,
              durationMin: input.durationMin,
              startTime: slotToDate(input.dateStr, start, tz),
              endTime: slotToDate(input.dateStr, end, tz),
              status: input.status,
              notes: input.notes || null,
              createdBy: input.createdBy,
            })
            .returning();
          await tx
            .insert(notifications)
            .values({
              barberId: input.barberId,
              type: input.createdBy === "barbero" ? "manual_booking" : "new_booking",
              title: input.createdBy === "barbero" ? "Cita creada manualmente" : "🔔 Nueva reserva",
              body:
                input.createdBy === "barbero"
                  ? `${input.clientName} — ${input.serviceName} (creada por el barbero).`
                  : `${input.clientName} reservó ${input.serviceName}. Fecha: ${input.dateStr} · Hora: ${minutesToLabel(start)}.`,
            })
            .catch(() => {});
          return { ok: true as const, appointment: appt };
        } catch (e: unknown) {
          const err = e as { code?: string };
          if (err?.code !== "23505") throw e;
        }
      }
      throw new Error("No se pudo generar un código de reserva.");
    });
  } catch (e) {
    console.error("createAppointmentTx error", e);
    return { ok: false, error: "No se pudo completar la reserva. Intenta de nuevo." };
  }
}

/* ---------------- stats ---------------- */

/** Stats for the dashboard & statistics pages. */
export async function computeStats(barberId: string, tz: string) {
  const today = todayStrInTz(tz);
  const weekStart = addDaysStr(today, -6);
  const monthStart = addDaysStr(today, -29);
  const startOfToday = localMidnight(today, tz);
  const startOfWeek = localMidnight(weekStart, tz);
  const startOfMonth = localMidnight(monthStart, tz);

  const all = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.barberId, barberId), gte(appointments.startTime, startOfMonth)));

  const todayRows = all.filter((a) => a.startTime >= startOfToday);
  const weekRows = all.filter((a) => a.startTime >= startOfWeek);
  const sumPrice = (rows: Appointment[]) =>
    rows.reduce((s, r) => s + (r.status === "atendida" ? r.price : 0), 0);

  const statusCount = (rows: Appointment[], s: string) => rows.filter((r) => r.status === s).length;

  const revenueByDay: { date: string; label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDaysStr(today, -i);
    const start = localMidnight(d, tz).getTime();
    const rows = all.filter((a) => {
      const t = a.startTime.getTime();
      return t >= start && t < start + 24 * 3600 * 1000;
    });
    revenueByDay.push({ date: d, label: d.slice(8), total: sumPrice(rows) });
  }

  const serviceCount = new Map<string, number>();
  const hourCount = new Map<string, number>();
  for (const a of all) {
    if (a.status === "cancelada" || a.status === "no_asistio") continue;
    serviceCount.set(a.serviceName, (serviceCount.get(a.serviceName) || 0) + 1);
    const h = new Date(a.startTime.getTime()).getUTCHours() - Math.round(tzOffsetOf(tz));
    const key = `${((h + 24) % 24)}:00`;
    hourCount.set(key, (hourCount.get(key) || 0) + 1);
  }

  const clientRows = await db.select().from(clients).where(eq(clients.barberId, barberId));
  const monthClientStart = startOfMonth.getTime();
  const newClients = clientRows.filter((c) => c.firstVisit && c.firstVisit.getTime() >= monthClientStart).length;
  const recurring = clientRows.filter((c) => c.totalVisits >= 2).length;

  return {
    today: {
      total: todayRows.length,
      confirmadas: statusCount(todayRows, "confirmada"),
      pendientes: statusCount(todayRows, "pendiente"),
      en_espera: statusCount(todayRows, "en_espera"),
      canceladas: statusCount(todayRows, "cancelada"),
      ingresos: sumPrice(todayRows),
    },
    week: { total: weekRows.length, ingresos: sumPrice(weekRows) },
    month: { total: all.length, ingresos: sumPrice(all) },
    revenueByDay,
    topServices: [...serviceCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    topHours: [...hourCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    cancellations: all.filter((a) => a.status === "cancelada").length,
    noShows: all.filter((a) => a.status === "no_asistio").length,
    newClients,
    recurringClients: recurring,
    totalClients: clientRows.length,
  };
}

function tzOffsetOf(tz: string): number {
  // America/Bogota = -5 (UTC-5). Computed once via date-fns-tz at runtime.
  const { formatInTimeZone } = require("date-fns-tz") as typeof import("date-fns-tz");
  const s = formatInTimeZone(new Date(), tz, "XXX"); // e.g. "-05:00"
  const sign = s.startsWith("-") ? -1 : 1;
  const [h, m] = s.replace(/[+-]/, "").split(":").map(Number);
  return sign * (h + m / 60);
}

/** Payments for the income page. */
export async function getPayments(barberId: string) {
  return db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      createdAt: payments.createdAt,
      appointmentId: payments.appointmentId,
      code: appointments.code,
      clientName: clients.name,
      serviceName: appointments.serviceName,
      startTime: appointments.startTime,
    })
    .from(payments)
    .innerJoin(appointments, eq(payments.appointmentId, appointments.id))
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .where(eq(payments.barberId, barberId))
    .orderBy(payments.createdAt);
}
