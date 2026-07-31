"use client";

import { useCallback, useEffect, useState } from "react";
import { getClientDetail, listClients, updateClient } from "@/lib/actions";
import { money } from "@/lib/utils";

interface ClientRow {
  id: string; name: string; phone: string; email: string | null; notes: string | null;
  totalVisits: number; totalSpent: number; lastVisit: Date | null;
}
interface Detail {
  client: { id: string; name: string; phone: string; email: string | null; notes: string | null; totalVisits: number; totalSpent: number; firstVisit: string | null; lastVisit: string | null };
  history: { id: string; code: string; serviceName: string; price: number; startTime: string; status: string }[];
  tz: string;
}

export default function AdminClients() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ name: "", phone: "", email: "", notes: "" });

  const load = useCallback(async (query?: string) => {
    const rows = await listClients(query || undefined);
    setClients(rows as unknown as ClientRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    const d = await getClientDetail(id);
    if (d) {
      setDetail(d);
      setEditing(false);
    }
  };

  const save = async () => {
    if (!detail) return;
    await updateClient({ id: detail.client.id, name: edit.name, phone: edit.phone, email: edit.email, notes: edit.notes });
    setEditing(false);
    open(detail.client.id);
    load(q);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Clientes</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Base de datos de clientes e historial</p>
        </div>
        <input className="input max-w-[260px]" placeholder="Buscar por nombre…" value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2">
          {clients.length === 0 && <p className="py-8 text-center text-sm text-stone-400">Sin clientes aún.</p>}
          {clients.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className="flex w-full items-center gap-3 rounded-xl border border-stone-200 px-4 py-3 text-left transition hover:border-brand-500 dark:border-stone-800">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/15 font-black text-brand-600 dark:text-brand-400">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-bold">{c.name}</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">{c.phone} · {c.totalVisits} visitas · {money(c.totalSpent)}</p>
              </div>
              <span className="text-stone-400">→</span>
            </button>
          ))}
        </div>

        {detail && (
          <div className="card">
            {!editing ? (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-black uppercase">{detail.client.name}</h2>
                    <p className="text-sm text-stone-500 dark:text-stone-400">{detail.client.phone} · {detail.client.email || "sin correo"}</p>
                  </div>
                  <button onClick={() => { setEdit({ name: detail.client.name, phone: detail.client.phone, email: detail.client.email ?? "", notes: detail.client.notes ?? "" }); setEditing(true); }} className="btn-ghost btn-sm">
                    Editar
                  </button>
                </div>
                {detail.client.notes && <p className="mt-2 rounded-lg bg-stone-100 p-2 text-sm dark:bg-stone-800">{detail.client.notes}</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800">
                    <p className="text-xl font-black">{detail.client.totalVisits}</p>
                    <p className="text-[10px] font-bold uppercase text-stone-400">Citas</p>
                  </div>
                  <div className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800">
                    <p className="text-xl font-black">{money(detail.client.totalSpent)}</p>
                    <p className="text-[10px] font-bold uppercase text-stone-400">Total gastado</p>
                  </div>
                  <div className="rounded-xl bg-stone-100 p-3 dark:bg-stone-800">
                    <p className="text-xl font-black">{detail.client.lastVisit ? new Date(detail.client.lastVisit).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" }) : "—"}</p>
                    <p className="text-[10px] font-bold uppercase text-stone-400">Última visita</p>
                  </div>
                </div>
                <h3 className="mt-5 mb-2 font-black uppercase">Historial</h3>
                <div className="max-h-80 space-y-1.5 overflow-y-auto">
                  {detail.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                      <div>
                        <p className="font-semibold">{h.serviceName}</p>
                        <p className="text-xs text-stone-400">{new Date(h.startTime).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{money(h.price)}</p>
                        <p className="text-[10px] uppercase text-stone-400">{h.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <h2 className="font-black uppercase">Editar cliente</h2>
                <div>
                  <label className="label">Nombre</label>
                  <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                </div>
                <div>
                  <label className="label">Correo</label>
                  <input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                </div>
                <div>
                  <label className="label">Notas</label>
                  <textarea className="input" rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <button onClick={save} className="btn-primary flex-1">Guardar</button>
                  <button onClick={() => setEditing(false)} className="btn-ghost">Volver</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
