"use client";

import { useCallback, useEffect, useState } from "react";
import { createBarberAccount, listBarbers, resetBarberPassword, setBarberActive, updateBarberProfile } from "@/lib/actions";

interface BarberRow {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
  email: string | null;
  role: string | null;
}

function randomPassword() {
  return Math.random().toString(36).slice(2, 10);
}

export default function AdminTeam() {
  const [rows, setRows] = useState<BarberRow[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: randomPassword() });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BarberRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "" });
  const [resetFor, setResetFor] = useState<BarberRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const data = await listBarbers();
    setRows(data as unknown as BarberRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setShowNew(true);
    setForm({ name: "", phone: "", email: "", password: randomPassword() });
    setMsg(null);
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const res = await createBarberAccount(form);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: "Barbero creado. Comparte el correo y la contraseña con él por WhatsApp." });
    setShowNew(false);
    load();
  };

  const startEdit = (r: BarberRow) => {
    setEditing(r);
    setEditForm({ name: r.name, phone: r.phone ?? "" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateBarberProfile({ barberId: editing.id, name: editForm.name, phone: editForm.phone });
    setEditing(null);
    load();
  };

  const toggleActive = async (r: BarberRow) => {
    const verb = r.active ? "desactivar" : "activar";
    if (!confirm(`¿${verb.charAt(0).toUpperCase() + verb.slice(1)} a ${r.name}?`)) return;
    await setBarberActive(r.id, !r.active);
    load();
  };

  const openReset = (r: BarberRow) => {
    setResetFor(r);
    setResetPassword(randomPassword());
    setResetMsg(null);
  };

  const submitReset = async () => {
    if (!resetFor) return;
    const res = await resetBarberPassword(resetFor.id, resetPassword);
    setResetMsg(res.ok ? { ok: true, text: "Contraseña actualizada." } : { ok: false, text: res.error });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Equipo</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Barberos y sus cuentas de acceso al panel</p>
        </div>
        <button onClick={startNew} className="btn-primary">＋ Nuevo barbero</button>
      </div>

      {showNew && (
        <div className="card space-y-3">
          <h2 className="font-black uppercase">Nuevo barbero</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Nombre *</label>
              <input className="input" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Juan Pérez" />
            </div>
            <div>
              <label className="label">Teléfono / WhatsApp</label>
              <input className="input" name="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="300 123 4567" />
            </div>
            <div>
              <label className="label">Correo (para iniciar sesión) *</label>
              <input className="input" name="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="juan@correo.com" />
            </div>
            <div>
              <label className="label">Contraseña inicial *</label>
              <div className="flex gap-2">
                <input className="input" name="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" onClick={() => setForm({ ...form, password: randomPassword() })} className="btn-ghost btn-sm shrink-0">
                  🎲
                </button>
              </div>
              <p className="mt-1 text-[11px] text-stone-400">Compártela con él por WhatsApp; puede cambiarla luego desde Configuración.</p>
            </div>
          </div>
          {msg && (
            <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
              {msg.text}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className="btn-primary flex-1">{busy ? "Creando…" : "Crear barbero"}</button>
            <button onClick={() => setShowNew(false)} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rows.length === 0 && <p className="py-10 text-center text-sm text-stone-400">Sin barberos todavía.</p>}
        {rows.map((r) => (
          <div key={r.id} className={`card flex flex-wrap items-center gap-3 ${!r.active ? "opacity-50" : ""}`}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/15 font-black text-brand-600 dark:text-brand-400">
              {r.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-[160px] flex-1">
              <p className="font-bold">
                {r.name} {r.role === "admin" && <span className="chip bg-brand-500/15 text-brand-600 dark:text-brand-400">Admin</span>}
                {!r.active && <span className="chip bg-stone-200 text-stone-500 dark:bg-stone-800">Inactivo</span>}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {r.email ?? "Sin cuenta de acceso"} {r.phone ? `· ${r.phone}` : ""}
              </p>
            </div>
            {r.email && (
              <button onClick={() => openReset(r)} className="btn-ghost btn-sm">🔐 Restablecer clave</button>
            )}
            <button onClick={() => startEdit(r)} className="btn-ghost btn-sm">Editar</button>
            <button onClick={() => toggleActive(r)} className={`btn-ghost btn-sm ${r.active ? "text-red-500 dark:text-red-400" : "text-emerald-500"}`}>
              {r.active ? "Desactivar" : "Activar"}
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md space-y-3 bg-white dark:bg-stone-900">
            <h3 className="font-black uppercase">Editar barbero</h3>
            <div>
              <label className="label">Nombre</label>
              <input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Teléfono / WhatsApp</label>
              <input className="input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={saveEdit} className="btn-primary flex-1">Guardar</button>
              <button onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md space-y-3 bg-white dark:bg-stone-900">
            <h3 className="font-black uppercase">Restablecer contraseña de {resetFor.name}</h3>
            <div>
              <label className="label">Nueva contraseña</label>
              <div className="flex gap-2">
                <input className="input" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
                <button type="button" onClick={() => setResetPassword(randomPassword())} className="btn-ghost btn-sm shrink-0">🎲</button>
              </div>
            </div>
            {resetMsg && (
              <p className={`rounded-lg px-3 py-2 text-sm font-medium ${resetMsg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
                {resetMsg.text}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={submitReset} className="btn-primary flex-1">Guardar</button>
              <button onClick={() => setResetFor(null)} className="btn-ghost">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
