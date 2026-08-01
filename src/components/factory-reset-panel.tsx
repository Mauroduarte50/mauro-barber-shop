"use client";

import { useState } from "react";
import { factoryReset } from "@/lib/actions";

const CONFIRM_WORD = "ELIMINAR";

const WILL_DELETE = [
  "Todas las reservas y citas",
  "Todos los clientes",
  "Todos los servicios",
  "Horarios laborales y descansos",
  "Bloqueos manuales de horario",
  "Registros de ingresos (pagos)",
  "Notificaciones internas",
  "Suscripciones de notificaciones push (tendrás que reactivarlas)",
];

const WILL_KEEP = ["Tu cuenta de administrador (correo y contraseña)", "El registro del barbero (nombre, slug)", "La configuración general del negocio (nombre, WhatsApp, dirección, etc.)"];

type Status = "idle" | "confirming" | "working" | "done" | "error";

export default function FactoryResetPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");

  const open = () => {
    setConfirmText("");
    setError("");
    setStatus("confirming");
  };

  const close = () => {
    if (status === "working") return;
    setStatus("idle");
    setConfirmText("");
    setError("");
  };

  const confirm = async () => {
    if (confirmText !== CONFIRM_WORD || status === "working") return;
    setStatus("working");
    setError("");
    const res = await factoryReset(confirmText);
    if (res.ok) {
      setStatus("done");
      setTimeout(() => {
        window.location.href = "/login";
      }, 2200);
    } else {
      setStatus("confirming");
      setError(res.error);
    }
  };

  return (
    <div className="card space-y-3 border-2 border-red-500/60">
      <h2 className="font-black uppercase text-red-600 dark:text-red-400">⚠️ Zona de peligro</h2>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Borra todos los datos operativos (citas, clientes, servicios, horarios, ingresos) y deja el sistema como
        recién instalado. Tu cuenta de administrador nunca se borra. Esta acción no se puede deshacer.
      </p>
      <button onClick={open} className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-700">
        Resetear todos los datos
      </button>

      {status !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md border-2 border-red-500/60 bg-white dark:bg-stone-900">
            {status === "done" ? (
              <div className="py-4 text-center">
                <p className="text-3xl">✅</p>
                <p className="mt-2 font-black uppercase">Sistema reseteado correctamente</p>
                <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                  Vuelve a iniciar sesión y configura todo desde cero: servicios, horarios y bloqueos.
                  Redirigiendo al login…
                </p>
              </div>
            ) : (
              <>
                <h3 className="font-black uppercase text-red-600 dark:text-red-400">¿Resetear todo el sistema?</h3>

                <p className="mt-3 text-xs font-bold uppercase tracking-wider text-stone-400">Se borrará</p>
                <ul className="mt-1 space-y-1 text-sm text-stone-600 dark:text-stone-300">
                  {WILL_DELETE.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-red-500">✕</span>
                      {item}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-xs font-bold uppercase tracking-wider text-stone-400">Se conserva</p>
                <ul className="mt-1 space-y-1 text-sm text-stone-600 dark:text-stone-300">
                  {WILL_KEEP.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-emerald-500">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>

                <label className="label mt-4">
                  Escribe <span className="font-black text-red-600 dark:text-red-400">{CONFIRM_WORD}</span> para confirmar
                </label>
                <input
                  className="input"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={status === "working"}
                  placeholder={CONFIRM_WORD}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />

                {error && <p className="mt-2 text-sm font-medium text-red-500">{error}</p>}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={close} disabled={status === "working"} className="btn-ghost w-full disabled:opacity-60">
                    Cancelar
                  </button>
                  <button
                    onClick={confirm}
                    disabled={confirmText !== CONFIRM_WORD || status === "working"}
                    className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {status === "working" ? "Reseteando…" : "Sí, resetear todo"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
