import { NextResponse } from "next/server";
import { getDefaultBarber, getAppSettings } from "@/lib/settings";

// Served as a route handler (not a static public/ file) so the manifest
// name always matches the configured business name — see manifest.ts for
// the client (root) manifest, which does the same for a different reason
// (separate PWA install scope for /admin, see admin/layout.tsx).
export async function GET() {
  const barber = await getDefaultBarber();
  const settings = await getAppSettings(barber?.id ?? "");
  const name = settings.businessName || "Barbería";

  return NextResponse.json({
    name: `${name} — Panel`,
    short_name: `${name} Panel`,
    description: "Panel del barbero: citas, calendario, clientes y notificaciones.",
    start_url: "/admin",
    scope: "/admin",
    id: "/admin",
    display: "standalone",
    background_color: "#0c1420",
    theme_color: "#0c1420",
    lang: "es",
    orientation: "portrait",
    icons: [
      { src: "/images/icon-admin-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icon-admin-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icon-admin-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/images/icon-admin-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
}
