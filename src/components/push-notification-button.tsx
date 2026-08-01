"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, deletePushSubscription, getPushSubscriptionStatus } from "@/lib/actions";

type Status = "checking" | "unsupported" | "denied" | "off" | "on" | "working";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export default function PushNotificationButton() {
  const [status, setStatus] = useState<Status>("checking");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          setStatus("off");
          return;
        }
        // A subscription can exist in the browser but not in our DB (e.g.
        // after a fresh deploy/DB reset) — confirm with the server.
        const res = await getPushSubscriptionStatus(sub.endpoint);
        setStatus(res.subscribed ? "on" : "off");
      } catch {
        setStatus("off");
      }
    })();
  }, []);

  const activate = async () => {
    setMsg("");
    setStatus("working");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setStatus("off");
        setMsg("Las notificaciones push aún no están configuradas en el servidor.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        if (permission !== "denied") setMsg("No se otorgó el permiso de notificaciones.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setStatus("off");
        setMsg("No se pudo obtener la suscripción del navegador.");
        return;
      }
      const res = await savePushSubscription({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      if (res.ok) {
        setStatus("on");
      } else {
        setStatus("off");
        setMsg(res.error);
      }
    } catch {
      setStatus("off");
      setMsg("No se pudo activar. Intenta de nuevo.");
    }
  };

  const deactivate = async () => {
    setStatus("working");
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
    } catch {
      // even if unsubscribe fails locally, treat it as off
    } finally {
      setStatus("off");
    }
  };

  return (
    <div className="card space-y-3">
      <h2 className="font-black uppercase">🔔 Notificaciones push</h2>
      <p className="text-xs text-stone-400">
        Recibe una notificación en este dispositivo (con sonido, aunque tengas la pantalla bloqueada) cada vez que
        entre una reserva nueva, se cancele o se reprograme una cita.
      </p>

      {status === "checking" && <div className="h-11 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800" />}

      {status === "unsupported" && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          Este navegador no soporta notificaciones push. En iPhone: instala el sitio en la pantalla de inicio desde
          Safari (compartir → &quot;Agregar a pantalla de inicio&quot;) y abre la app desde ahí — Safari en pestaña
          normal no puede recibir push en iOS.
        </p>
      )}

      {status === "denied" && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          Bloqueaste el permiso de notificaciones para este sitio. Actívalo desde los ajustes del navegador o del
          celular (Ajustes → Notificaciones → esta app) y recarga la página.
        </p>
      )}

      {status === "on" && (
        <>
          <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-600">
            ✅ Notificaciones activas en este dispositivo
          </p>
          <button onClick={deactivate} className="btn-ghost btn-sm">
            Desactivar en este dispositivo
          </button>
        </>
      )}

      {(status === "off" || status === "working") && (
        <button onClick={activate} disabled={status === "working"} className="btn-primary w-full disabled:opacity-60">
          {status === "working" ? "Activando…" : "Activar notificaciones en este dispositivo"}
        </button>
      )}

      {msg && <p className="text-xs font-medium text-red-500">{msg}</p>}
    </div>
  );
}
