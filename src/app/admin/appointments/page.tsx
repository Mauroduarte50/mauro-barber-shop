"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  listServices,
  setAppointmentStatus,
} from "@/lib/actions";
import { APPOINTMENT_STATUSES, STATUS_LABELS } from "@/db/schema";
import { money } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  pendiente: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  confirmada: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  en_espera: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  atendida: "bg-stone-500/15 text-stone-600 dark:text-stone-300",
  cancelada: "bg-red-500/15 text-red-600 dark:text-red-400",
  no_asistio: "bg-stone-500/15 text-stone-500",
};

interface Row {
  id: string; code: string; serviceName: string; price: number; durationMin: number;
  startTime: string; status: string; clientName: string; clientPhone: string;
}

export default function AdminAppointments() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; price: number; durationMin: number }[]>([]);
  const [filter, setFilter] = useState({ status: "", date: "", q: "" });
  const [showNew, setShowNew] = useState(searchParams.get("new") === "1");
  const [form, setForm] = useState({ clientName: "", clientPhone: "", clientEmail: "", serviceId: "", date: "", time: "09:00", notes: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await listAppointments({
      status: filter.status || undefined,
      date: filter.date || undefined,
      q: filter.q || undefined,
    });
    setRows(rows);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listServices().then(setServices);
  }, []);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setFilter((f) => ({ ...f, q }));
  }, [searchParams]);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const res = await createAppointment({ ...form, serviceId: form.serviceId || undefined });
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: `Cita creada: ${res.code}` });
    setShowNew(false);
    setForm({ clientName: "", clientPhone: "", clientEmail: "", serviceId: "", date: "", time: "09:00", notes: "" });
    load();
  };

  const changeStatus = async (id: string, status: string) => {
    await setAppointmentStatus(id, status);
    load();
  };

  const cancel = async (id: string) => {
    if (!confirm("¿Cancelar esta cita?")) return;
    await cancelAppointment(id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Citas</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Crea, modifica y gestiona reservas</p>
        </div>
        <button onClick={() => { setShowNew(true); setMsg(null); }} className="btn-primary">＋ Nueva cita</button>
      </div>

      {showNew && (
        <div className="card space-y-3">
          <h2 className="font-black uppercase">Nueva cita</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Cliente *</label>
              <input className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="Juan Pérez" />
            </div>
            <div>
              <label className="label">Teléfono *</label>
              <input className="input" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="300 123 4567" />
            </div>
            <div>
              <label className="label">Correo</label>
              <input className="input" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} placeholder="opcional" />
            </div>
            <div>
              <label className="label">Servicio</label>
              <select className="input" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                <option value="">Cita manual (sin servicio)</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {money(s.price)} · {s.durationMin}min</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Fecha *</label>
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label className="label">Hora *</label>
              <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Observaciones</label>
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="opcional" />
            </div>
          </div>
          {msg && (
            <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
              {msg.text}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className="btn-primary flex-1">{busy ? "Guardando…" : "Guardar cita"}</button>
            <button onClick={() => setShowNew(false)} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      )}

      {/* filters */}
      <div className="card flex flex-wrap gap-2">
        <input className="input max-w-[220px]" placeholder="Buscar (nombre, teléfono, código)" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <input className="input max-w-[180px]" type="date" value={filter.date} onChange={(e) => setFilter({ ...filter, date: e.target.value })} />
        <select className="input max-w-[160px]" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Todos los estados</option>
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button onClick={() => setFilter({ status: "", date: "", q: "" })} className="btn-ghost btn-sm">Limpiar</button>
      </div>

      <div className="space-y-2">
        {rows.length === 0 && <p className="py-10 text-center text-sm text-stone-400">No hay citas con esos filtros.</p>}
        {rows.map((a) => (
          <div key={a.id} className="card flex flex-wrap items-center gap-3">
            <div className="min-w-[130px]">
              <p className="font-black">{new Date(a.startTime).toLocaleDateString("es-CO", { weekday: "short", day: "2-digit", month: "short" })}</p>
              <p className="text-sm font-bold text-brand-600 dark:text-brand-400">
                {new Date(a.startTime).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <div className="min-w-[160px] flex-1">
              <p className="font-bold">{a.clientName}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">{a.serviceName} · {a.durationMin} min · {a.code}</p>
            </div>
            <p className="font-black text-brand-600 dark:text-brand-400">{money(a.price)}</p>
            <select
              value={a.status}
              onChange={(e) => changeStatus(a.id, e.target.value)}
              className={`chip cursor-pointer appearance-none border-0 ${STATUS_COLORS[a.status] ?? ""}`}
            >
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            {a.status !== "cancelada" && a.status !== "atendida" && (
              <button onClick={() => cancel(a.id)} className="btn-ghost btn-sm text-red-500 dark:text-red-400">✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
