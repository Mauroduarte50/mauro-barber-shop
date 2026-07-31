"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getOverview, markAllNotificationsRead, listNotifications } from "@/lib/actions";
import { money } from "@/lib/utils";

export default function AdminDashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getOverview>> | null>(null);
  const [notifs, setNotifs] = useState<Awaited<ReturnType<typeof listNotifications>>>([]);

  useEffect(() => {
    getOverview().then(setData);
    listNotifications().then(setNotifs);
  }, []);

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const s = data.stats.today;
  const cards = [
    { label: "Citas de hoy", value: s.total, icon: "✂️", to: "/admin/appointments" },
    { label: "Confirmadas", value: s.confirmadas, icon: "✅", to: "/admin/appointments?status=confirmada" },
    { label: "Pendientes", value: s.pendientes, icon: "⏳", to: "/admin/appointments?status=pendiente" },
    { label: "Canceladas", value: s.canceladas, icon: "✕", to: "/admin/appointments?status=cancelada" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Dashboard</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Resumen del día</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/appointments?new=1" className="btn-primary">＋ Nueva cita</Link>
          <Link href="/admin/blocks" className="btn-ghost">🔒 Bloquear horario</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.to} className="card transition hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-2xl">{c.icon}</span>
            </div>
            <p className="mt-2 text-3xl font-black">{c.value}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400">{c.label}</p>
          </Link>
        ))}
        <div className="card bg-brand-500 text-stone-950">
          <p className="text-2xl">💰</p>
          <p className="mt-2 text-3xl font-black">{money(s.ingresos)}</p>
          <p className="text-xs font-bold uppercase tracking-wider opacity-70">Ingresos estimados (atendidas)</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today timeline */}
        <div className="card lg:col-span-2">
          <h2 className="mb-3 font-black uppercase">Hoy · Agenda</h2>
          {data.todayAppointments.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-400">Sin citas para hoy 🎉</p>
          ) : (
            <div className="space-y-2">
              {data.todayAppointments.map((a) => {
                const t = new Date(a.startTime);
                const statusColor: Record<string, string> = {
                  pendiente: "border-amber-400",
                  confirmada: "border-emerald-500",
                  en_espera: "border-sky-500",
                  atendida: "border-stone-400",
                  cancelada: "border-red-500 opacity-50",
                  no_asistio: "border-stone-600 opacity-50",
                };
                return (
                  <div key={a.id} className={`flex items-center gap-3 rounded-xl border-l-4 bg-stone-50 px-4 py-3 dark:bg-stone-800/50 ${statusColor[a.status] ?? "border-stone-400"}`}>
                    <span className="w-16 text-sm font-black tabular-nums">
                      {t.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div className="flex-1">
                      <p className="font-bold">{a.clientName}</p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">{a.serviceName} · {a.durationMin} min</p>
                    </div>
                    <span className="hidden text-sm font-black text-brand-600 dark:text-brand-400 sm:block">{money(a.price)}</span>
                    <span className="chip capitalize bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300">{a.status}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/admin/calendar" className="btn-ghost w-full">📅 Ver calendario</Link>
            <Link href="/admin/appointments" className="btn-ghost w-full">Ver todas las citas</Link>
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black uppercase">🔔 Notificaciones</h2>
            {data.unreadCount > 0 && (
              <button onClick={() => markAllNotificationsRead().then(() => { getOverview().then(setData); setNotifs([]); })} className="text-xs font-semibold text-brand-500 underline">
                Marcar leídas
              </button>
            )}
          </div>
          <div className="space-y-2">
            {notifs.slice(0, 6).map((n) => (
              <div key={n.id} className={`rounded-xl border px-3 py-2 text-sm ${n.read ? "border-stone-200 dark:border-stone-800" : "border-brand-500/50 bg-brand-500/5"}`}>
                <p className="font-bold">{n.title}</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">{n.body}</p>
              </div>
            ))}
            {notifs.length === 0 && <p className="py-6 text-center text-sm text-stone-400">Sin notificaciones</p>}
          </div>
          <Link href="/admin/notifications" className="btn-ghost btn-sm mt-3 w-full">Ver todas</Link>
        </div>
      </div>
    </div>
  );
}
