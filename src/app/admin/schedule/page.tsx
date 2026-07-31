"use client";

import { useEffect, useState } from "react";
import { getSchedule, saveBreaks, saveBusinessHours } from "@/lib/actions";
import { minutesToLabel } from "@/lib/utils";

const DAYS = [
  { wd: 1, name: "Lunes" },
  { wd: 2, name: "Martes" },
  { wd: 3, name: "Miércoles" },
  { wd: 4, name: "Jueves" },
  { wd: 5, name: "Viernes" },
  { wd: 6, name: "Sábado" },
  { wd: 7, name: "Domingo" },
];

function toTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function toMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

interface DayState {
  blocks: { start: string; end: string }[];
  breaks: { start: string; end: string }[];
}

export default function AdminSchedule() {
  const [state, setState] = useState<Record<number, DayState>>({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getSchedule().then((s) => {
      const next: Record<number, DayState> = {};
      DAYS.forEach((d) => {
        next[d.wd] = { blocks: [], breaks: [] };
      });
      s.hours.forEach((h) => {
        next[h.weekday].blocks.push({ start: toTime(h.startMin), end: toTime(h.endMin) });
      });
      s.breaks.forEach((b) => {
        next[b.weekday].breaks.push({ start: toTime(b.startMin), end: toTime(b.endMin) });
      });
      setState(next);
      setLoaded(true);
    });
  }, []);

  const addBlock = (wd: number) => {
    setState((s) => ({ ...s, [wd]: { ...s[wd], blocks: [...s[wd].blocks, { start: "08:00", end: "12:00" }] } }));
  };
  const addBreak = (wd: number) => {
    setState((s) => ({ ...s, [wd]: { ...s[wd], breaks: [...s[wd].breaks, { start: "12:00", end: "14:00" }] } }));
  };

  const setBlock = (wd: number, i: number, key: "start" | "end", val: string) => {
    setState((s) => {
      const blocks = [...s[wd].blocks];
      blocks[i] = { ...blocks[i], [key]: val };
      return { ...s, [wd]: { ...s[wd], blocks } };
    });
  };
  const setBreak = (wd: number, i: number, key: "start" | "end", val: string) => {
    setState((s) => {
      const breaks = [...s[wd].breaks];
      breaks[i] = { ...breaks[i], [key]: val };
      return { ...s, [wd]: { ...s[wd], breaks } };
    });
  };

  const saveDay = async (wd: number) => {
    const day = state[wd];
    const hours = day.blocks.map((b) => ({ startMin: toMin(b.start), endMin: toMin(b.end) }));
    const brks = day.breaks.map((b) => ({ startMin: toMin(b.start), endMin: toMin(b.end), label: "Descanso" }));
    await saveBusinessHours(wd, hours);
    await saveBreaks(wd, brks);
    setMsg(`Horario del ${DAYS.find((d) => d.wd === wd)?.name} guardado.`);
    setTimeout(() => setMsg(""), 2500);
  };

  if (!loaded) return <div className="card h-40 animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Horarios de trabajo</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Varios bloques por día · los descansos se ocultan automáticamente</p>
        </div>
        {msg && <span className="chip bg-emerald-500/15 text-emerald-600">{msg}</span>}
      </div>

      <div className="space-y-3">
        {DAYS.map((d) => (
          <div key={d.wd} className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black uppercase">{d.name}</h2>
              <div className="flex gap-2">
                <button onClick={() => addBlock(d.wd)} className="btn-ghost btn-sm">＋ Bloque</button>
                <button onClick={() => addBreak(d.wd)} className="btn-ghost btn-sm">＋ Descanso</button>
                <button onClick={() => saveDay(d.wd)} className="btn-primary btn-sm">Guardar</button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="label">Horas laborales</p>
                <div className="space-y-2">
                  {state[d.wd].blocks.length === 0 && <p className="text-sm text-stone-400">Descanso (sin horas laborales)</p>}
                  {state[d.wd].blocks.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="input w-32" type="time" value={b.start} onChange={(e) => setBlock(d.wd, i, "start", e.target.value)} />
                      <span>–</span>
                      <input className="input w-32" type="time" value={b.end} onChange={(e) => setBlock(d.wd, i, "end", e.target.value)} />
                      <button onClick={() => setState((s) => ({ ...s, [d.wd]: { ...s[d.wd], blocks: s[d.wd].blocks.filter((_, j) => j !== i) } }))} className="btn-ghost btn-sm text-red-500">✕</button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="label">Descansos</p>
                <div className="space-y-2">
                  {state[d.wd].breaks.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="input w-32" type="time" value={b.start} onChange={(e) => setBreak(d.wd, i, "start", e.target.value)} />
                      <span>–</span>
                      <input className="input w-32" type="time" value={b.end} onChange={(e) => setBreak(d.wd, i, "end", e.target.value)} />
                      <button onClick={() => setState((s) => ({ ...s, [d.wd]: { ...s[d.wd], breaks: s[d.wd].breaks.filter((_, j) => j !== i) } }))} className="btn-ghost btn-sm text-red-500">✕</button>
                    </div>
                  ))}
                  {state[d.wd].breaks.length === 0 && (
                    <p className="text-xs text-stone-400">Sin descansos configurados. Ej: 12:00 – 14:00</p>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-stone-400">
              Vista: {state[d.wd].blocks.length ? state[d.wd].blocks.map((b) => `${minutesToLabel(toMin(b.start))} – ${minutesToLabel(toMin(b.end))}`).join(" / ") : "Descanso"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
