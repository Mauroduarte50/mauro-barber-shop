"use client";

import { useEffect, useState } from "react";
import { changePassword, getSettingsData, saveSettingsData } from "@/lib/actions";
import { DEFAULT_TZ } from "@/lib/utils";

const FIELDS: { key: string; label: string; placeholder?: string; hint?: string }[] = [
  { key: "business_name", label: "Nombre de la barbería" },
  { key: "business_tagline", label: "Frase corta" },
  { key: "business_description", label: "Descripción" },
  { key: "business_address", label: "Dirección" },
  { key: "business_phone", label: "Teléfono" },
  { key: "business_whatsapp", label: "WhatsApp (con código de país)" },
  { key: "business_instagram", label: "Instagram (usuario)" },
  { key: "business_facebook", label: "Facebook (URL)" },
  { key: "site_url", label: "URL del sitio (para el QR)", placeholder: "https://midominio.com" },
  { key: "cancellation_policy", label: "Política de cancelación", hint: "Se muestra al cliente al cancelar" },
  { key: "timezone", label: "Zona horaria", placeholder: DEFAULT_TZ },
];

const NUMERIC: { key: string; label: string; suffix: string }[] = [
  { key: "cancel_window_min", label: "Ventana de cancelación", suffix: "min antes" },
  { key: "min_advance_min", label: "Anticipación mínima para reservar", suffix: "min" },
  { key: "max_advance_days", label: "Anticipación máxima (días)", suffix: "días" },
  { key: "gap_min", label: "Separación entre citas", suffix: "min" },
  { key: "slot_step", label: "Intervalo de horarios", suffix: "min" },
];

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const QR_URL = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=16&data=${encodeURIComponent(`${SITE_URL}/reservar`)}`;

export default function AdminSettings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    getSettingsData().then((m) => {
      setValues(m as unknown as Record<string, string>);
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    const res = await saveSettingsData(values);
    setMsg(res.ok ? "Configuración guardada." : "Error al guardar.");
    setTimeout(() => setMsg(""), 2500);
  };

  const savePw = async () => {
    const res = await changePassword(pw.current, pw.next);
    setPwMsg(res.ok ? "Contraseña actualizada." : res.error);
    if (res.ok) setPw({ current: "", next: "" });
  };

  if (!loaded) return <div className="card h-40 animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Configuración</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Perfil, reglas de reserva y seguridad</p>
        </div>
        <button onClick={save} className="btn-primary">Guardar cambios</button>
      </div>

      {msg && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-600">{msg}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-black uppercase">🏪 Información general</h2>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input
                className="input"
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
              {f.hint && <p className="mt-1 text-[11px] text-stone-400">{f.hint}</p>}
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-black uppercase">⚖️ Reglas de reserva</h2>
            {NUMERIC.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <div className="flex items-center gap-2">
                  <input
                    className="input"
                    type="number"
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                  <span className="shrink-0 text-xs text-stone-400">{f.suffix}</span>
                </div>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={values.reminders_enabled !== "false"}
                onChange={(e) => setValues({ ...values, reminders_enabled: e.target.checked ? "true" : "false" })}
                className="h-4 w-4 accent-amber-500"
              />
              Recordatorios activados (preparado para WhatsApp/Telegram)
            </label>
          </div>

          <div className="card">
            <h2 className="mb-2 font-black uppercase">📲 Código QR de reservas</h2>
            <p className="mb-3 text-xs text-stone-400">Apunta a {SITE_URL}/reservar — ideal para WhatsApp, tarjetas y el local.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={QR_URL} alt="QR de reservas" width={180} height={180} className="rounded-xl bg-white p-2" />
            <a href={QR_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm mt-3">Descargar QR</a>
          </div>

          <div className="card space-y-3">
            <h2 className="font-black uppercase">🔐 Cambiar contraseña</h2>
            <input className="input" type="password" placeholder="Contraseña actual" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input className="input" type="password" placeholder="Nueva contraseña (mín 6)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            {pwMsg && <p className="text-sm font-medium text-emerald-500">{pwMsg}</p>}
            <button onClick={savePw} className="btn-ghost">Actualizar contraseña</button>
          </div>
        </div>
      </div>
    </div>
  );
}
