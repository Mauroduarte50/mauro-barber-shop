import { NextResponse } from "next/server";
import { getBarberBySlug, getDefaultBarber, getActiveServices } from "@/lib/settings";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("barber");
  const barber = slug ? await getBarberBySlug(slug) : await getDefaultBarber();
  if (!barber) return NextResponse.json({ error: "Sin barbero configurado" }, { status: 404 });
  const services = await getActiveServices(barber.id);
  return NextResponse.json({
    barberId: barber.id,
    services: services
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        durationMin: s.durationMin,
        image: s.image,
      })),
  });
}
