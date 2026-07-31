import { NextResponse } from "next/server";
import { getBarberBySlug, getDefaultBarber, getAppSettings } from "@/lib/settings";
import { minutesToLabel } from "@/lib/utils";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("barber");
  const barber = slug ? await getBarberBySlug(slug) : await getDefaultBarber();
  if (!barber) return NextResponse.json({ error: "Sin barbero configurado" }, { status: 404 });
  const settings = await getAppSettings(barber.id);
  return NextResponse.json({
    barber: {
      id: barber.id,
      name: barber.name,
      slug: barber.slug,
      bio: barber.bio,
      photo: barber.photo,
      phone: barber.phone,
      instagram: barber.instagram,
    },
    business: {
      name: settings.businessName,
      tagline: settings.businessTagline,
      description: settings.businessDescription,
      address: settings.businessAddress,
      phone: settings.businessPhone,
      whatsapp: settings.businessWhatsapp,
      instagram: settings.businessInstagram,
      facebook: settings.businessFacebook,
    },
    settings: {
      timezone: settings.timezone,
      currency: settings.currency,
      cancellationPolicy: settings.cancellationPolicy,
      cancelWindowMin: settings.cancelWindowMin,
      minAdvanceMin: settings.minAdvanceMin,
      maxAdvanceDays: settings.maxAdvanceDays,
      gapMin: settings.gapMin,
      slotStep: settings.slotStep,
      hoursLabel: buildHoursLabel(barber.id, settings.timezone),
    },
  });
}

async function buildHoursLabel(barberId: string, tz: string) {
  const { db } = await import("@/db");
  const { businessHours } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select().from(businessHours).where(eq(businessHours.barberId, barberId));
  const byDay = new Map<number, { startMin: number; endMin: number }[]>();
  for (const r of rows) {
    const arr = byDay.get(r.weekday) ?? [];
    arr.push({ startMin: r.startMin, endMin: r.endMin });
    byDay.set(r.weekday, arr);
  }
  const names = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const parts: string[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    const arr = byDay.get(wd);
    if (!arr || !arr.length) parts.push(`${names[wd]}: Descanso`);
    else parts.push(`${names[wd]}: ${arr.map((b) => `${minutesToLabel(b.startMin)} – ${minutesToLabel(b.endMin)}`).join(" / ")}`);
  }
  return parts;
}
