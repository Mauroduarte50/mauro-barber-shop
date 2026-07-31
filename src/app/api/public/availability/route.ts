import { NextResponse } from "next/server";
import { getBarberBySlug, getDefaultBarber, getAppSettings } from "@/lib/settings";
import { getDayAvailability } from "@/lib/availability";
import { addDaysStr, todayStrInTz } from "@/lib/utils";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("barber");
  const barber = slug ? await getBarberBySlug(slug) : await getDefaultBarber();
  if (!barber) return NextResponse.json({ error: "Sin barbero configurado" }, { status: 404 });
  const settings = await getAppSettings(barber.id);

  const date = url.searchParams.get("date");
  const range = Number(url.searchParams.get("range"));
  const duration = Math.max(5, Number(url.searchParams.get("duration")) || 30);

  const today = todayStrInTz(settings.timezone);

  // Range mode: summaries for the next N days (used by the date picker).
  if (range > 0 && range <= 90) {
    const opts = {
      tz: settings.timezone,
      gapMin: settings.gapMin,
      slotStep: settings.slotStep,
      minAdvanceMin: settings.minAdvanceMin,
      maxAdvanceDays: settings.maxAdvanceDays,
    };
    const days = [];
    for (let i = 0; i < range; i++) {
      const d = addDaysStr(today, i);
      const day = await getDayAvailability(barber.id, d, duration, opts);
      days.push({ date: d, working: day.working, reason: day.reason, count: day.availableCount, weekdayLabel: day.weekdayLabel });
    }
    return NextResponse.json({ range: true, days, today, maxAdvanceDays: settings.maxAdvanceDays });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  if (date < today) return NextResponse.json({ error: "No puedes elegir una fecha pasada" }, { status: 400 });
  if (date > addDaysStr(today, settings.maxAdvanceDays)) {
    return NextResponse.json({ error: "Fecha fuera del rango permitido" }, { status: 400 });
  }

  const day = await getDayAvailability(barber.id, date, duration, {
    tz: settings.timezone,
    gapMin: settings.gapMin,
    slotStep: settings.slotStep,
    minAdvanceMin: settings.minAdvanceMin,
    maxAdvanceDays: settings.maxAdvanceDays,
  });

  return NextResponse.json({
    date: day.date,
    working: day.working,
    reason: day.reason,
    weekdayLabel: day.weekdayLabel,
    availableCount: day.availableCount,
    slots: day.slots,
  });
}
