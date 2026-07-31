import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients, services } from "@/db/schema";
import { getBarberBySlug, getDefaultBarber, getAppSettings } from "@/lib/settings";
import { createAppointmentTx, getDayAvailability } from "@/lib/availability";
import { audit } from "@/lib/system";
import { isValidEmail, isValidPhone, sanitizeText, todayStrInTz } from "@/lib/utils";

// Simple in-memory rate limit (per IP) to protect the public booking endpoint.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= 30) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta en un minuto." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const slug = typeof body.barber === "string" ? body.barber : undefined;
  const barber = slug ? await getBarberBySlug(slug) : await getDefaultBarber();
  if (!barber) return NextResponse.json({ error: "Sin barbero configurado" }, { status: 404 });
  const settings = await getAppSettings(barber.id);

  const name = sanitizeText(body.name, 100);
  const phone = sanitizeText(body.phone, 30);
  const email = sanitizeText(body.email, 120);
  const notes = sanitizeText(body.notes, 500);
  const date = typeof body.date === "string" ? body.date : "";
  const startMin = Number(body.startMin);
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";

  if (!name || !phone) return NextResponse.json({ error: "Nombre y teléfono son obligatorios." }, { status: 400 });
  if (!isValidPhone(phone)) return NextResponse.json({ error: "Número de teléfono inválido." }, { status: 400 });
  if (email && !isValidEmail(email)) return NextResponse.json({ error: "Correo electrónico inválido." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(startMin)) {
    return NextResponse.json({ error: "Fecha u hora inválida." }, { status: 400 });
  }

  const today = todayStrInTz(settings.timezone);
  if (date < today) return NextResponse.json({ error: "No puedes reservar en una fecha pasada." }, { status: 400 });

  const serviceRows = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.barberId, barber.id), eq(services.active, true)))
    .limit(1);
  const service = serviceRows[0];
  if (!service) return NextResponse.json({ error: "Servicio inválido o inactivo." }, { status: 400 });

  const opts = {
    tz: settings.timezone,
    gapMin: settings.gapMin,
    slotStep: settings.slotStep,
    minAdvanceMin: settings.minAdvanceMin,
    maxAdvanceDays: settings.maxAdvanceDays,
  };

  // Authoritative availability check (same engine used for display).
  const day = await getDayAvailability(barber.id, date, service.durationMin, opts);
  const slot = day.slots.find((s) => s.startMin === startMin);
  if (!day.working || !slot || slot.status !== "available") {
    return NextResponse.json(
      { error: "Ese horario ya no está disponible. Por favor elige otro." },
      { status: 409 },
    );
  }

  const result = await createAppointmentTx({
    barberId: barber.id,
    clientName: name,
    clientPhone: phone,
    clientEmail: email || undefined,
    serviceId: service.id,
    serviceName: service.name,
    price: service.price,
    durationMin: service.durationMin,
    dateStr: date,
    startMin,
    notes: notes || undefined,
    createdBy: "cliente",
    status: "confirmada",
    opts,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const a = result.appointment;
  await audit(null, "Cliente", "create_booking", `Reserva ${a.code}: ${name} — ${service.name} ${date} ${startMin}`);

  return NextResponse.json({
    ok: true,
    booking: {
      id: a.id,
      code: a.code,
      clientName: name,
      serviceName: a.serviceName,
      price: a.price,
      durationMin: a.durationMin,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString(),
      status: a.status,
      barberName: barber.name,
      barberPhone: settings.businessWhatsapp,
      businessName: settings.businessName,
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "Parámetro phone requerido" }, { status: 400 });
  const barber = await getDefaultBarber();
  if (!barber) return NextResponse.json({ error: "Sin barbero configurado" }, { status: 404 });
  const rows = await db
    .select({
      id: appointments.id,
      code: appointments.code,
      serviceName: appointments.serviceName,
      startTime: appointments.startTime,
      status: appointments.status,
      clientName: clients.name,
    })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .where(and(eq(clients.phone, phone), eq(appointments.barberId, barber.id)))
    .orderBy(appointments.startTime);
  return NextResponse.json({
    bookings: rows.map((r) => ({ ...r, startTime: r.startTime.toISOString() })),
  });
}
