"use client";

import { useCallback, useEffect, useState } from "react";
import { createBlock, deleteBlock, listBlocks } from "@/lib/actions";
import { minutesToLabel } from "@/lib/utils";

interface BlockRow {
  id: string; date: string; startMin: number; endMin: number; reason: string | null; allDay: boolean;
}

export default function AdminBlocks() {
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [form, setForm] = useState({ date: "", start: "14:00", end: "15:30", reason: "", allDay: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const rows = await listBlocks();
    setBlocks(rows as unknown as BlockRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const submit = async () => {
    setMsg(null);
    if (!form.date) {
      setMsg({ ok: false, text: "Elige una fecha." });
      return;
    }
    await createBlock({
      date: form.date,
      startMin: form.allDay ? 0 : toMin(form.start),
      endMin: form.allDay ? 1440 : toMin(form.end),
      reason: form.reason,
      allDay: form.allDay,
    });
    setMsg({ ok: true, text: "Horario bloqueado." });
    setForm({ date: "", start: "14:00", end: "15:30", reason: "", allDay: false });
    load();
  };

  const remove = async (id: string) => {
    await deleteBlock(id);
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black uppercase">Bloqueos de horario</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">Bloquea fechas o rangos específicos (vacaciones, diligencias, festivos)</p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-black uppercase">Nuevo bloqueo</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Fecha *</label>
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="h-4 w-4 accent-amber-500" />
              Todo el día
            </label>
          </div>
          {!form.allDay && (
            <>
              <div>
                <label className="label">Desde</label>
                <input className="input" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </div>
              <div>
                <label className="label">Hasta</label>
                <input className="input" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <label className="label">Motivo</label>
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ej: Diligencia personal, vacaciones…" />
          </div>
        </div>
        {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>{msg.text}</p>}
        <button onClick={submit} className="btn-primary">Bloquear horario</button>
      </div>

      <div className="space-y-2">
        {blocks.map((b) => (
          <div key={b.id} className="card flex items-center gap-3">
            <span className="text-xl">🔒</span>
            <div className="flex-1">
              <p className="font-bold">
                {new Date(b.date + "T00:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {b.allDay ? "Todo el día" : `${minutesToLabel(b.startMin)} – ${minutesToLabel(b.endMin)}`}
                {b.reason ? ` · ${b.reason}` : ""}
              </p>
            </div>
            <button onClick={() => remove(b.id)} className="btn-ghost btn-sm text-red-500">Eliminar</button>
          </div>
        ))}
        {blocks.length === 0 && <p className="py-8 text-center text-sm text-stone-400">Sin bloqueos configurados.</p>}
      </div>
    </div>
  );
}
