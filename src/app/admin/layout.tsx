import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getDefaultBarber, getAppSettings } from "@/lib/settings";
import { logoutAction } from "@/lib/actions";
import { BrandFooter } from "@/components/brand-footer";

// Own manifest + icons so a home-screen icon installed from /admin (the
// barber's panel) opens straight into /admin — distinct from the client
// icon installed from / or /reservar, which uses the root manifest.ts.
// This `manifest` field overrides the root layout's file-convention-derived
// one for every route under this segment (singular metadata fields are
// resolved by nearest-segment-wins, same rule as `title`/`description`).
export async function generateMetadata(): Promise<Metadata> {
  const barber = await getDefaultBarber();
  const settings = barber ? await getAppSettings(barber.id) : null;
  const name = settings?.businessName || "Barbería";
  return {
    title: "Panel",
    applicationName: `${name} — Panel`,
    manifest: "/admin-manifest.webmanifest",
    icons: {
      icon: "/images/icon-admin-192.png",
      apple: "/images/icon-admin-192.png",
    },
    appleWebApp: {
      capable: true,
      title: `${name} Panel`,
      statusBarStyle: "black-translucent",
    },
  };
}

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "📊" },
  { href: "/admin/calendar", label: "Calendario", icon: "📅" },
  { href: "/admin/appointments", label: "Citas", icon: "✂️" },
  { href: "/admin/clients", label: "Clientes", icon: "👥" },
  { href: "/admin/services", label: "Servicios", icon: "💈" },
  { href: "/admin/schedule", label: "Horarios", icon: "🕐" },
  { href: "/admin/blocks", label: "Bloqueos", icon: "🔒" },
  { href: "/admin/income", label: "Ingresos", icon: "💰" },
  { href: "/admin/stats", label: "Estadísticas", icon: "📈" },
  { href: "/admin/notifications", label: "Notificaciones", icon: "🔔" },
  { href: "/admin/settings", label: "Configuración", icon: "⚙️" },
];

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const barber = await getDefaultBarber();
  const settings = barber ? await getAppSettings(barber.id) : null;

  const unread = barber
    ? await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.barberId, barber.id), eq(notifications.read, false)))
    : [];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 md:flex">
        <Link href="/admin" className="mb-6 flex items-center gap-2 px-2">
          <span className="text-2xl">✂️</span>
          <div>
            <p className="text-sm font-black uppercase leading-tight">{settings?.businessName ?? "Barbería"}</p>
            <p className="text-[10px] uppercase tracking-wider text-stone-400">Panel del barbero</p>
          </div>
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="navlink">
              <span>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.href === "/admin/notifications" && unread.length > 0 && (
                <span className="chip bg-red-500 text-white">{unread.length}</span>
              )}
            </Link>
          ))}
        </nav>
        <form action={logoutAction} className="mt-4">
          <button className="navlink w-full text-left text-red-500 dark:text-red-400">🚪 Cerrar sesión</button>
        </form>
        <BrandFooter className="mt-3" />
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 md:pl-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90 md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/admin" className="flex min-h-11 items-center gap-2">
              <span className="text-xl">✂️</span>
              <span className="text-sm font-black uppercase">{settings?.businessName ?? "Panel"}</span>
            </Link>
            <Link href="/admin/notifications" className="relative flex h-11 w-11 items-center justify-center text-lg">
              🔔
              {unread.length > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {unread.length}
                </span>
              )}
            </Link>
          </div>
          <nav className="scrollbar-hide flex gap-1 overflow-x-auto px-3 pb-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="chip flex min-h-11 shrink-0 items-center border border-stone-200 bg-stone-100 px-3 py-1.5 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
              >
                {item.icon} {item.label}
              </Link>
            ))}
            <form action={logoutAction} className="contents">
              <button className="chip flex min-h-11 shrink-0 items-center border border-stone-200 bg-stone-100 px-3 py-1.5 text-red-500 dark:border-stone-700 dark:bg-stone-900 dark:text-red-400">
                🚪 Cerrar sesión
              </button>
            </form>
          </nav>
        </header>
        <main className="p-4 sm:p-6">
          {children}
          <BrandFooter className="mt-8 pb-2 md:hidden" />
        </main>
      </div>
    </div>
  );
}
