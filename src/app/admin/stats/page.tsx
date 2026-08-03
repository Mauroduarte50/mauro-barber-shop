"use client";

import { useEffect, useState } from "react";
import { getStatsData } from "@/lib/actions";
import { money } from "@/lib/utils";
import { useBarberScope } from "@/components/barber-scope";

export default function AdminStats() {
  const { scope } = useBarberScope();
  const [data, setData] = useState<Awaited<ReturnType<typeof getStatsData>> | null>(null);

  useEffect(() => {
    getStatsData(scope || undefined).then(setData);
  }, [scope]);

  if (!data) return <div className="card h-40 animate-pulse" />;

  const s = data.stats;
  const maxRev = Math.max(...s.revenueByDay.map((d) => d.total), 1);
  const maxService = Math.max(...s.topServices.map((x) => x[1]), 1);
  const maxHour = Math.max(...s.topHours.map((x) => x[1]), 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black uppercase">Estadísticas</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">Últimos 30 días</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Citas hoy", v: String(s.today.total) },
          { l: "Citas semana", v: String(s.week.total) },
          { l: "Citas mes", v: String(s.month.total) },
          { l: "Ingresos día", v: money(s.today.ingresos) },
          { l: "Ingresos semana", v: money(s.week.ingresos) },
          { l: "Ingresos mes", v: money(s.month.ingresos) },
          { l: "Clientes nuevos", v: String(s.newClients) },
          { l: "Clientes recurrentes", v: String(s.recurringClients) },
          { l: "Cancelaciones", v: String(s.cancellations) },
          { l: "Inasistencias", v: String(s.noShows) },
          { l: "Total clientes", v: String(s.totalClients) },
        ].map((c) => (
          <div key={c.l} className="card">
            <p className="text-xl font-black">{c.v}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{c.l}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-black uppercase">Ingresos últimos 7 días</h2>
          <div className="flex h-40 items-end gap-2">
            {s.revenueByDay.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-stone-400">{d.total ? money(d.total) : ""}</span>
                <div className="w-full rounded-t-lg bg-brand-500" style={{ height: `${Math.max((d.total / maxRev) * 100, 2)}%` }} />
                <span className="text-[10px] font-bold text-stone-400">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 font-black uppercase">Servicios más vendidos</h2>
          <div className="space-y-3">
            {s.topServices.map(([name, count]) => (
              <div key={name}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{name}</span>
                  <span className="text-stone-400">{count} citas</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-stone-200 dark:bg-stone-800">
                  <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(count / maxService) * 100}%` }} />
                </div>
              </div>
            ))}
            {s.topServices.length === 0 && <p className="text-sm text-stone-400">Sin datos todavía.</p>}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 font-black uppercase">Horarios más solicitados</h2>
          <div className="space-y-3">
            {s.topHours.map(([hour, count]) => (
              <div key={hour}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{hour}</span>
                  <span className="text-stone-400">{count}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-stone-200 dark:bg-stone-800">
                  <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(count / maxHour) * 100}%` }} />
                </div>
              </div>
            ))}
            {s.topHours.length === 0 && <p className="text-sm text-stone-400">Sin datos todavía.</p>}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 font-black uppercase">Resumen del mes</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Confirmadas", s.today.confirmadas + s.month.total - s.cancellations - s.noShows],
              ["Pendientes", s.today.pendientes],
              ["Canceladas", s.cancellations],
              ["No asistieron", s.noShows],
              ["Ingresos", money(s.month.ingresos)],
              ["Promedio cita", s.month.total ? money(Math.round(s.month.ingresos / Math.max(s.month.total - s.cancellations - s.noShows, 1))) : money(0)],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800">
                <p className="text-lg font-black">{v}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
