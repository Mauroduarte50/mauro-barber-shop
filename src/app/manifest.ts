import type { MetadataRoute } from "next";
import { getDefaultBarber, getAppSettings } from "@/lib/settings";

// Reads the business name from the DB on every request — without this,
// Next.js prerenders the manifest once at build time and freezes whatever
// name existed then, so a later change in /admin/settings would never show.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const barber = await getDefaultBarber();
  const settings = await getAppSettings(barber?.id ?? "");
  const name = settings.businessName || "Barbería";

  return {
    name: `${name} — Reservas`,
    short_name: name,
    description: "Reserva tu cita en la barbería desde tu celular.",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    background_color: "#0c0a09",
    theme_color: "#0c0a09",
    lang: "es",
    orientation: "portrait",
    icons: [
      { src: "/images/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
