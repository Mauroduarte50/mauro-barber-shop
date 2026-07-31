"use client";

import { useCallback, useEffect, useState } from "react";
import { listNotifications, markAllNotificationsRead } from "@/lib/actions";

interface NotifRow {
  id: string; type: string; title: string; body: string; read: boolean; createdAt: string;
}

export default function AdminNotifications() {
  const [notifs, setNotifs] = useState<NotifRow[]>([]);

  const load = useCallback(async () => {
    const rows = await listNotifications();
    setNotifs(rows as unknown as NotifRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Notificaciones</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Eventos del sistema: reservas, cancelaciones, reprogramaciones</p>
        </div>
        <button onClick={() => markAllNotificationsRead().then(load)} className="btn-ghost btn-sm">✓ Marcar todas como leídas</button>
      </div>

      <div className="space-y-2">
        {notifs.map((n) => (
          <div key={n.id} className={`card flex items-start gap-3 ${n.read ? "" : "border-brand-500/50 bg-brand-500/5"}`}>
            <span className="text-xl">{n.title.includes("🔔") ? "🔔" : "ℹ️"}</span>
            <div className="flex-1">
              <p className="font-bold">{n.title.replace("🔔 ", "")}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">{n.body}</p>
              <p className="mt-1 text-[11px] text-stone-400">
                {new Date(n.createdAt).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {!n.read && <span className="mt-1 h-2 w-2 rounded-full bg-brand-500" />}
          </div>
        ))}
        {notifs.length === 0 && <p className="py-10 text-center text-sm text-stone-400">Sin notificaciones.</p>}
      </div>
    </div>
  );
}
