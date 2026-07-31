import { NextResponse } from "next/server";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, barbers, clients, notifications } from "@/db/schema";
import { getAppSettings } from "@/lib/settings";
import { getDayAvailability } from "@/lib/availability";
import { audit } from "@/lib/system";
import { localMidnight, minutesToLabel, slotToDate } from "@/lib/utils";

async function loadBooking(code: string) {
  const rows = await db
    .select({
      a: appointments,
      clientName: clients.name,
      clientPhone: clients.phone,
      clientEmail: clients.email,
      barberName: barbers.name,
      barberPhone: barbers.phone,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .innerJoin(barbers, eq(appointments.barberId, barbers.id))
    .where(eq(appointments.code, code.toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const row = await loadBooking(code);
  if (!row) return NextResponse.json({ error: "Reserva no encontrada." }, { status: 404 });
  const settings = await getAppSettings(row.a.barberId);
  return NextResponse.json({
    booking: {
      id: row.a.id,
      code: row.a.code,
      serviceName: row.a.serviceName,
      price: row.a.price,
      durationMin: row.a.durationMin,
      startTime: row.a.startTime.toISOString(),
      endTime: row.a.endTime.toISOString(),
      status: row.a.status,
      notes: row.a.notes,
      createdBy: row.a.createdBy,
      cancelledAt: row.a.cancelledAt ? row.a.cancelledAt.toISOString() : null,
      cancelledBy: row.a.cancelledBy,
      rescheduledFrom: row.a.rescheduledFrom ? row.a.rescheduledFrom.toISOString() : null,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      clientEmail: row.clientEmail,
      barberName: row.barberName,
      barberPhone: row.barberPhone,
      businessName: settings.businessName,
      businessWhatsapp: settings.businessWhatsapp,
      cancellationPolicy: settings.cancellationPolicy,
      cancelWindowMin: settings.cancelWindowMin,
      tz: settings.timezone,
      timezone: settings.timezone,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const row = await loadBooking(code);
  if (!row) return NextResponse.json({ error: "Reserva no encontrada." }, { status: 404 });
  const a = row.a;
  if (a.status === "cancelada" || a.status === "no_asistio" || a.status === "atendida") {
    return NextResponse.json({ error: "Esta cita ya no puede reprogramarse." }, { status: 400 });
  }

  let body: { date?: string; startMin?: number; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.phone && body.phone.replace(/\D/g, "") !== row.clientPhone.replace(/\D/g, "")) {
    return NextResponse.json({ error: "El teléfono no coincide con la reserva." }, { status: 403 });
  }
  const date = body.date ?? "";
  const startMin = Number(body.startMin);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(startMin)) {
    return NextResponse.json({ error: "Fecha u hora inválida." }, { status: 400 });
  }

  const settings = await getAppSettings(a.barberId);
  const opts = {
    tz: settings.timezone,
    gapMin: settings.gapMin,
    slotStep: settings.slotStep,
    minAdvanceMin: settings.minAdvanceMin,
    maxAdvanceDays: settings.maxAdvanceDays,
  };
  const day = await getDayAvailability(a.barberId, date, a.durationMin, opts, a.id);
  const slot = day.slots.find((s) => s.startMin === startMin);
  if (!day.working || !slot || slot.status !== "available") {
    return NextResponse.json({ error: "Ese horario ya no está disponible." }, { status: 409 });
  }

  const oldStart = a.startTime;
  const newStart = slotToDate(date, startMin, opts.tz);
  const newEnd = slotToDate(date, startMin + a.durationMin, opts.tz);

  const lockKey = `barber:${a.barberId}:${date}`;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);
      const dayStartUtc = localMidnight(date, opts.tz);
      const rows = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.barberId, a.barberId),
            gte(appointments.startTime, dayStartUtc),
            lt(appointments.startTime, new Date(dayStartUtc.getTime() + 24 * 3600 * 1000)),
            sql`${appointments.status} NOT IN ('cancelada','no_asistio')`,
            ne(appointments.id, a.id),
          ),
        );
      const dayStartMs = dayStartUtc.getTime();
      for (const other of rows) {
        const oStart = (other.startTime.getTime() - dayStartMs) / 60000;
        const oEnd = (other.endTime.getTime() - dayStartMs) / 60000 + opts.gapMin;
        if (startMin < oEnd && oStart < startMin + a.durationMin) {
          throw new Error("CONFLICT");
        }
      }
      await tx
        .update(appointments)
        .set({ startTime: newStart, endTime: newEnd, rescheduledFrom: oldStart, status: "confirmada", updatedAt: new Date() })
        .where(eq(appointments.id, a.id));
      await tx
        .insert(notifications)
        .values({
          barberId: a.barberId,
          type: "rescheduled",
          title: "Cita reprogramada",
          body: `${a.code} se movió a ${date} ${minutesToLabel(startMin)}.`,
        })
        .catch(() => {});
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === "CONFLICT")) {
      console.error("Reschedule error", e);
    }
    const msg = e instanceof Error && e.message === "CONFLICT" ? "Ese horario ya no está disponible." : "No se pudo reprogramar la cita.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  await audit(null, "Cliente", "reschedule_booking", `Reprogramó ${a.code} a ${date} ${minutesToLabel(startMin)}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const row = await loadBooking(code);
  if (!row) return NextResponse.json({ error: "Reserva no encontrada." }, { status: 404 });
  const a = row.a;
  if (a.status === "cancelada" || a.status === "atendida") {
    return NextResponse.json({ error: "Esta cita ya no puede cancelarse." }, { status: 400 });
  }
  const settings = await getAppSettings(a.barberId);
  const now = new Date();
  const minutesUntil = (a.startTime.getTime() - now.getTime()) / 60000;
  if (minutesUntil < settings.cancelWindowMin) {
    return NextResponse.json(
      { error: `Ya no puedes cancelar en línea. Política: ${settings.cancellationPolicy}` },
      { status: 400 },
    );
  }
  await db
    .update(appointments)
    .set({ status: "cancelada", cancelledAt: now, cancelledBy: "cliente", updatedAt: now })
    .where(eq(appointments.id, a.id));
  await db
    .insert(notifications)
    .values({
      barberId: a.barberId,
      type: "cancelled",
      title: "Cita cancelada",
      body: `${a.code} (${row.clientName}) fue cancelada por el cliente.`,
    })
    .catch(() => {});
  await audit(null, "Cliente", "cancel_booking", `Canceló ${a.code}`);
  return NextResponse.json({ ok: true });
}
