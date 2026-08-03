"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCalendarData } from "@/lib/actions";
import { money } from "@/lib/utils";
import { useBarberScope } from "@/components/barber-scope";

type View = "day" | "week" | "month";
interface CalData {
  tz: string;
  start: string;
  offsetMin: number;
  gapMin: number;
  appointments: {
    id: string; code: string; serviceName: string; price: number; durationMin: number;
    startTime: string; endTime: string; status: string; clientName: string; clientPhone: string; barberName?: string;
  }[];
  workHours: { weekday: number; startMin: number; endMin: number }[];
  blocks: { date: string; startMin: number; endMin: number; reason: string | null }[];
}

const STATUS_COLORS: Record<string, string> = {
  pendiente: "bg-amber-400 border-amber-500",
  confirmada: "bg-emerald-500 border-emerald-600",
  en_espera: "bg-sky-500 border-sky-600",
  atendida: "bg-stone-500 border-stone-600",
  cancelada: "bg-red-500/60 border-red-600",
  no_asistio: "bg-stone-600/60 border-stone-700",
};

function fmtDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminCalendar() {
  const { scope } = useBarberScope();
  const [view, setView] = useState<View>("day");
  const [ref, setRef] = useState(() => fmtDateStr(new Date()));
  const [data, setData] = useState<CalData | null>(null);

  const spanDays = view === "day" ? 1 : view === "week" ? 7 : 35;

  useEffect(() => {
    getCalendarData(ref, spanDays, scope || undefined).then(setData);
  }, [ref, spanDays, scope]);

  const move = (dir: number) => {
    const base = new Date(ref + "T00:00:00Z");
    if (view === "day") base.setUTCDate(base.getUTCDate() + dir);
    else if (view === "week") base.setUTCDate(base.getUTCDate() + dir * 7);
    else base.setUTCMonth(base.getUTCMonth() + dir);
    setRef(fmtDateStr(base));
  };

  const gotoToday = () => setRef(fmtDateStr(new Date()));

  const localMin = (iso: string) => {
    const t = new Date(iso).getTime();
    const day = new Date(iso);
    const dayStr = fmtDateStr(day);
    const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    return (t - dayStart) / 60000 - (data?.offsetMin ?? -300);
  };

  const byDate = useMemo(() => {
    const map = new Map<string, typeof data extends null ? never : NonNullable<typeof data>["appointments"]>();
    data?.appointments.forEach((a) => {
      const d = fmtDateStr(new Date(a.startTime));
      const arr = map.get(d) ?? [];
      arr.push(a);
      map.set(d, arr);
    });
    return map;
  }, [data]);

  const monthDays = useMemo(() => {
    if (view !== "month") return [];
    const [y, m] = ref.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const startDow = (first.getUTCDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: { date: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < startDow; i++) {
      const d = new Date(Date.UTC(y, m - 1, -startDow + i));
      cells.push({ date: fmtDateStr(d), day: d.getUTCDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: fmtDateStr(new Date(Date.UTC(y, m - 1, d))), day: d, inMonth: true });
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1];
      const d = new Date(last.date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      cells.push({ date: fmtDateStr(d), day: d.getUTCDate(), inMonth: false });
    }
    return cells;
  }, [ref, view]);

  const workingWeekday = (wd: number) => data?.workHours.some((h) => h.weekday === wd);

  const hourMin = 6;
  const hourMax = 21;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black uppercase">Calendario</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => move(-1)} className="btn-ghost btn-sm">←</button>
          <button onClick={gotoToday} className="btn-ghost btn-sm">Hoy</button>
          <button onClick={() => move(1)} className="btn-ghost btn-sm">→</button>
          <div className="flex rounded-xl border border-stone-300 p-0.5 dark:border-stone-700">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1 text-xs font-bold uppercase ${view === v ? "bg-brand-500 text-stone-950" : "text-stone-500"}`}
              >
                {v === "day" ? "Día" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "day" && (
        <div className="card overflow-x-auto p-3">
          <div className="min-w-[560px]">
            {Array.from({ length: hourMax - hourMin }).map((_, i) => {
              const h = hourMin + i;
              const appts = (byDate.get(ref) ?? []).filter((a) => {
                const m = localMin(a.startTime);
                return m >= h * 60 && m < (h + 1) * 60;
              });
              return (
                <div key={h} className="flex border-b border-stone-100 py-1 dark:border-stone-800">
                  <span className="w-14 shrink-0 pt-1 text-right text-xs font-bold tabular-nums text-stone-400">
                    {String(h % 24).padStart(2, "0")}:00
                  </span>
                  <div className="ml-3 flex flex-1 flex-wrap gap-2">
                    {appts.map((a) => (
                      <Link
                        key={a.id}
                        href={`/admin/appointments?q=${a.code}`}
                        className={`rounded-lg border-l-4 px-3 py-2 text-sm text-white shadow ${STATUS_COLORS[a.status] ?? "bg-stone-500"}`}
                      >
                        <p className="font-bold">
                          {new Date(a.startTime).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })} · {a.clientName}
                        </p>
                        <p className="text-xs opacity-90">{a.serviceName} · {money(a.price)} {a.barberName ? `· ${a.barberName}` : ""}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="card overflow-x-auto p-3">
          <div className="grid min-w-[760px] grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => {
              const d = new Date(ref + "T00:00:00Z");
              d.setUTCDate(d.getUTCDate() + i);
              const ds = fmtDateStr(d);
              const wd = ((d.getUTCDay() + 6) % 7) + 1;
              const appts = byDate.get(ds) ?? [];
              return (
                <div key={ds} className="min-h-[420px] rounded-xl border border-stone-200 p-2 dark:border-stone-800">
                  <button onClick={() => { setView("day"); setRef(ds); }} className="w-full text-center">
                    <p className="text-xs font-bold uppercase text-stone-400">
                      {d.toLocaleDateString("es-CO", { weekday: "short" })}
                    </p>
                    <p className={`text-lg font-black ${ds === fmtDateStr(new Date()) ? "text-brand-500" : ""}`}>{d.getUTCDate()}</p>
                    {!workingWeekday(wd) && <p className="text-[10px] text-stone-400">Descanso</p>}
                  </button>
                  <div className="mt-2 space-y-1.5">
                    {appts.map((a) => (
                      <Link key={a.id} href={`/admin/appointments?q=${a.code}`} className={`block rounded-lg border-l-4 px-2 py-1.5 text-xs text-white ${STATUS_COLORS[a.status] ?? "bg-stone-500"}`}>
                        <p className="font-bold">
                          {new Date(a.startTime).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })} · {a.clientName}
                        </p>
                        <p className="opacity-90">{a.serviceName} {a.barberName ? `· ${a.barberName}` : ""}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "month" && (
        <div className="card overflow-x-auto p-3">
          <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-bold uppercase text-stone-400">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid min-w-[640px] grid-cols-7 gap-2">
            {monthDays.map((c) => {
              const appts = byDate.get(c.date) ?? [];
              const wd = ((new Date(c.date + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
              const blocked = data?.blocks.some((b) => b.date === c.date);
              return (
                <button
                  key={c.date}
                  onClick={() => { setView("day"); setRef(c.date); }}
                  className={`min-h-[72px] rounded-xl border p-1.5 text-left transition ${
                    c.inMonth ? "border-stone-200 dark:border-stone-800" : "border-transparent opacity-30"
                  } ${blocked ? "bg-red-500/10" : ""}`}
                >
                  <p className={`text-xs font-black ${c.date === fmtDateStr(new Date()) ? "text-brand-500" : ""}`}>{c.day}</p>
                  {!workingWeekday(wd) && !blocked && <p className="text-[9px] text-stone-400">—</p>}
                  {blocked && <p className="text-[9px] text-red-500">🔒</p>}
                  {appts.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {appts.slice(0, 3).map((a) => (
                        <span key={a.id} className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[a.status] ?? "bg-stone-400"}`} />
                      ))}
                      {appts.length > 3 && <span className="text-[9px] font-bold text-stone-400">+{appts.length - 3}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
