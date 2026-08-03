import { NextResponse } from "next/server";
import { getDefaultBarber, getAppSettings } from "@/lib/settings";

// Served as a route handler (not a static public/ file) so the manifest
// name always matches the configured business name — see manifest.ts for
// the client (root) manifest, which does the same for a different reason
// (separate PWA install scope for /admin, see admin/layout.tsx).
//
// Without this, a Route Handler with no dynamic API calls can get
// statically optimized/cached by Next.js, same freeze risk as manifest.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  const barber = await getDefaultBarber();
  const settings = await getAppSettings(barber?.id ?? "");
  const name = settings.businessName || "Barbería";

  return NextResponse.json(
    {
      name: `${name} — Panel`,
      short_name: `${name} Panel`,
      description: "Panel del barbero: citas, calendario, clientes y notificaciones.",
      start_url: "/admin",
      // Scope is intentionally wider than start_url. /login (reached when the
      // session cookie expires, or via logoutAction) lives outside "/admin" —
      // if it were excluded from scope, the standalone app window would be
      // forced to break out into a regular browser tab/window to show it
      // (spec-mandated behavior for out-of-scope navigations), which is what
      // reused an already-open Safari tab instead of showing /login in the
      // installed app. `id` (not `scope`) is what keeps this a distinct
      // installed app from the client manifest below.
      scope: "/",
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
    },
    // Match the Content-Type Next.js's own manifest.ts file convention uses
    // (application/manifest+json) rather than NextResponse.json's default
    // application/json — some WebKit versions are strict about this when
    // deciding whether a "Add to Home Screen" icon is a real installable
    // web app vs. a plain bookmark.
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
