"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteService, listServices, saveService } from "@/lib/actions";
import { money } from "@/lib/utils";

interface ServiceRow {
  id: string; name: string; description: string | null; price: number; durationMin: number; active: boolean;
}

export default function AdminServices() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [form, setForm] = useState({ id: "", name: "", description: "", price: "20000", durationMin: "30", active: true });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const rows = await listServices();
    setServices(rows as unknown as ServiceRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setEditing({ id: "", name: "", description: "", price: 20000, durationMin: 30, active: true } as ServiceRow);
    setForm({ id: "", name: "", description: "", price: "20000", durationMin: "30", active: true });
    setMsg(null);
  };

  const startEdit = (s: ServiceRow) => {
    setEditing(s);
    setForm({ id: s.id, name: s.name, description: s.description ?? "", price: String(s.price), durationMin: String(s.durationMin), active: s.active });
    setMsg(null);
  };

  const save = async () => {
    setMsg(null);
    const res = await saveService({
      id: form.id || undefined,
      name: form.name,
      description: form.description,
      price: Number(form.price),
      durationMin: Number(form.durationMin),
      active: form.active,
    });
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: "Servicio guardado." });
    setEditing(null);
    load();
  };

  const remove = async (s: ServiceRow) => {
    if (!confirm(`¿Eliminar "${s.name}"? Las citas anteriores conservarán el nombre.`)) return;
    await deleteService(s.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Servicios</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Precios, duración y disponibilidad</p>
        </div>
        <button onClick={startNew} className="btn-primary">＋ Nuevo servicio</button>
      </div>

      {editing && (
        <div className="card space-y-3">
          <h2 className="font-black uppercase">{form.id ? "Editar servicio" : "Nuevo servicio"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Nombre *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Corte clásico" />
            </div>
            <div>
              <label className="label">Precio (COP) *</label>
              <input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div>
              <label className="label">Duración (minutos) *</label>
              <input className="input" type="number" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-amber-500" />
                Servicio activo
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Descripción</label>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Fade, tijera y acabado" />
            </div>
          </div>
          {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>{msg.text}</p>}
          <div className="flex gap-2">
            <button onClick={save} className="btn-primary flex-1">Guardar</button>
            <button onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <div key={s.id} className={`card ${!s.active ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between">
              <p className="text-lg font-black uppercase">✂️ {s.name}</p>
              {!s.active && <span className="chip bg-stone-200 text-stone-500 dark:bg-stone-800">Inactivo</span>}
            </div>
            {s.description && <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{s.description}</p>}
            <div className="mt-3 flex items-end justify-between">
              <p className="text-xs text-stone-400">⏱ {s.durationMin} min</p>
              <p className="text-xl font-black text-brand-500">{money(s.price)}</p>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => startEdit(s)} className="btn-ghost btn-sm flex-1">Editar</button>
              <button onClick={() => remove(s)} className="btn-ghost btn-sm text-red-500 dark:text-red-400">Eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
