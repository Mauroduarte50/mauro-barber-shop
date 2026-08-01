"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { buildICS, money, waLink } from "@/lib/utils";
import { BrandFooter } from "@/components/brand-footer";

interface Config {
  barber: { id: string; name: string; slug: string; photo: string | null };
  business: { name: string; tagline: string; whatsapp: string; instagram: string };
  settings: {
    timezone: string;
    currency: string;
    cancellationPolicy: string;
    cancelWindowMin: number;
    minAdvanceMin: number;
    maxAdvanceDays: number;
    gapMin: number;
    slotStep: number;
  };
}
interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMin: number;
  image: string | null;
}
interface DaySummary {
  date: string;
  working: boolean;
  reason: string;
  count: number;
  weekdayLabel: string;
}
interface Slot {
  startMin: number;
  endMin: number;
  label: string;
  status: "available" | "occupied" | "blocked" | "past";
}
interface DayInfo {
  date: string;
  working: boolean;
  reason: string;
  weekdayLabel: string;
  availableCount: number;
  slots: Slot[];
}
interface BookingResult {
  id: string;
  code: string;
  clientName: string;
  serviceName: string;
  price: number;
  durationMin: number;
  startTime: string;
  endTime: string;
  status: string;
  barberName: string;
  barberPhone: string;
  businessName: string;
}

const STEPS = ["Servicio", "Fecha", "Hora", "Tus datos", "Confirmar"];

function dateLabel(dateStr: string, tz: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(dt);
}

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replace(/\//g, "-");
}

export default function ReservarPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center"><p className="text-stone-400">Cargando…</p></main>}>
      <ReservarWizard />
    </Suspense>
  );
}

function ReservarWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<Config | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [step, setStep] = useState(0);
  const [service, setService] = useState<Service | null>(null);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [dayInfo, setDayInfo] = useState<DayInfo | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BookingResult | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          fetch("/api/public/config", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/public/services", { cache: "no-store" }).then((r) => r.json()),
        ]);
        setConfig(c);
        setServices(s.services);
        const pre = searchParams.get("service");
        if (pre) {
          const svc = s.services.find((x: Service) => x.id === pre);
          if (svc) {
            setService(svc);
            setStep(1);
          }
        }
      } catch {
        setError("No se pudo cargar la información. Verifica tu conexión.");
      }
    })();
  }, [searchParams]);

  const tz = config?.settings.timezone ?? "America/Bogota";

  const loadDays = useCallback(
    async (duration: number) => {
      setLoading(true);
      try {
        const r = await fetch(`/api/public/availability?range=${config?.settings.maxAdvanceDays ?? 30}&duration=${duration}`, { cache: "no-store" });
        const data = await r.json();
        setDays(data.days ?? []);
      } finally {
        setLoading(false);
      }
    },
    [config],
  );

  useEffect(() => {
    if (service && config) loadDays(service.durationMin);
  }, [service, config, loadDays]);

  const selectDate = useCallback(
    async (d: string) => {
      setDate(d);
      setSlot(null);
      setDayInfo(null);
      setError("");
      setLoading(true);
      try {
        const r = await fetch(
          `/api/public/availability?date=${d}&duration=${service?.durationMin ?? 30}`,
          { cache: "no-store" },
        );
        const data = await r.json();
        setDayInfo(data);
        setStep(2);
      } finally {
        setLoading(false);
      }
    },
    [service],
  );

  const submit = async () => {
    if (!service || !date || !slot) return;
    if (!form.name.trim() || !form.phone.trim()) {
      setError("Escribe tu nombre y tu teléfono.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barber: config?.barber.slug,
          serviceId: service.id,
          date,
          startMin: slot.startMin,
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) {
          setError(data.error || "Ese horario ya fue reservado. Elige otro.");
          setSlot(null);
          if (date) selectDate(date);
        } else {
          setError(data.error || "No se pudo completar la reserva.");
        }
        setSubmitting(false);
        return;
      }
      setResult(data.booking);
      setStep(4);
    } catch {
      setError("Error de conexión. Revisa tu internet e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const downloadICS = () => {
    if (!result) return;
    const ics = buildICS(
      new Date(result.startTime),
      new Date(result.endTime),
      `${result.serviceName} — ${result.businessName}`,
      `Cita ${result.code} con ${result.barberName}`,
      config?.business.name ?? "",
    );
    const blob = new Blob([ics], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${result.code}.ics`;
    a.click();
  };

  const whatsappMsg = result
    ? `Hola ${result.barberName} 👋, soy ${result.clientName}. Tengo una cita confirmada:\n📌 ${result.serviceName}\n📅 ${new Date(result.startTime).toLocaleDateString("es-CO")}\n🕒 ${new Date(result.startTime).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}\n🔖 Código: ${result.code}`
    : "";

  const dateChips = useMemo(() => {
    if (!days.length) return [];
    return days.map((d) => ({
      ...d,
      label: dateLabel(d.date, tz),
      isToday: d.date === todayInTz(tz),
    }));
  }, [days, tz]);

  /* ---------- success screen ---------- */
  if (result) {
    const start = new Date(result.startTime);
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-10">
        <div className="animate-fade-up card overflow-hidden text-center">
          <div className="bg-brand-500 px-6 py-10 text-stone-950">
            <div className="text-6xl">✅</div>
            <h1 className="mt-3 text-3xl font-black uppercase">¡Reserva confirmada!</h1>
            <p className="mt-1 text-sm font-semibold opacity-70">Código: {result.code}</p>
          </div>
          <div className="space-y-3 p-6 text-left">
            {[
              ["Cliente", result.clientName],
              ["Servicio", result.serviceName],
              ["Fecha", start.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })],
              ["Hora", start.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })],
              ["Barbero", result.barberName],
              ["Valor", money(result.price)],
              ["Estado", "CONFIRMADA"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-stone-100 pb-2 last:border-0 dark:border-stone-800">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-400">{k}</span>
                <span className="text-right text-sm font-bold capitalize">{v}</span>
              </div>
            ))}
            <div className="grid gap-2 pt-2">
              <button onClick={downloadICS} className="btn-primary w-full">📆 Agregar al calendario</button>
              <a href={waLink(result.barberPhone || "", whatsappMsg)} target="_blank" rel="noopener noreferrer" className="btn-dark w-full">
                💬 Contactar por WhatsApp
              </a>
              <Link href={`/cita/${result.code}`} className="btn-ghost w-full">
                Gestionar mi cita
              </Link>
              <Link href="/" className="inline-block w-full py-2 text-center text-sm text-stone-400 underline">
                ← Volver al inicio
              </Link>
            </div>
          </div>
        </div>
        <BrandFooter className="mt-6" />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 pb-28">
      {/* header */}
      <div className="mb-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand-500">✂️ Reserva en línea</p>
        <h1 className="mt-1 text-3xl font-black uppercase">{config?.business.name ?? "Barbería"}</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Con {config?.barber.name ?? "tu barbero"} · {config?.business.tagline ?? ""}</p>
      </div>

      {/* progress */}
      <div className="mb-6 flex items-center justify-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i <= step ? "bg-brand-500 text-stone-950" : "bg-stone-200 text-stone-500 dark:bg-stone-800"
              }`}
            >
              {i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={`h-0.5 w-6 sm:w-10 ${i < step ? "bg-brand-500" : "bg-stone-200 dark:bg-stone-800"}`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* STEP 0: service */}
      {step === 0 && (
        <div className="animate-fade-up space-y-3">
          <h2 className="text-xl font-black uppercase">1. Elige tu servicio</h2>
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setService(s);
                setStep(1);
                setDate(null);
                setSlot(null);
              }}
              className={`card w-full text-left transition hover:-translate-y-0.5 ${service?.id === s.id ? "ring-2 ring-brand-500" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black uppercase">{s.name}</p>
                  <p className="text-sm text-stone-500 dark:text-stone-400">
                    ⏱ {s.durationMin} min{s.description ? ` · ${s.description}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-black text-brand-500">{money(s.price)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* STEP 1: date */}
      {step === 1 && (
        <div className="animate-fade-up">
          <h2 className="mb-3 text-xl font-black uppercase">2. Elige la fecha</h2>
          {loading && <p className="text-sm text-stone-400">Calculando disponibilidad…</p>}
          <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
            {dateChips.map((d) => {
              const disabled = !d.working;
              const selected = date === d.date;
              return (
                <button
                  key={d.date}
                  disabled={disabled}
                  onClick={() => selectDate(d.date)}
                  className={`flex w-[86px] shrink-0 flex-col items-center rounded-2xl border px-2 py-3 transition ${
                    selected
                      ? "border-brand-500 bg-brand-500 text-stone-950"
                      : disabled
                        ? "border-stone-200 opacity-40 dark:border-stone-800"
                        : "border-stone-300 bg-white hover:border-brand-500 dark:border-stone-700 dark:bg-stone-900"
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                    {d.isToday ? "Hoy" : d.label.split(" ")[0]}
                  </span>
                  <span className="text-2xl font-black">{d.label.split(" ")[1]}</span>
                  <span className="text-[10px] font-semibold uppercase opacity-70">{d.label.split(" ")[2]}</span>
                  <span className={`mt-1 text-[10px] font-bold ${selected ? "text-stone-900" : "text-brand-500"}`}>
                    {d.working ? `${d.count} libres` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
          <button onClick={() => setStep(0)} className="btn-ghost btn-sm mt-4">← Volver a servicios</button>
        </div>
      )}

      {/* STEP 2: time */}
      {step === 2 && (
        <div className="animate-fade-up">
          <h2 className="text-xl font-black uppercase">3. Elige la hora</h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            {service?.name} · {dayInfo?.weekdayLabel} {dayInfo?.date} · {service?.durationMin} min
          </p>
          {loading ? (
            <p className="mt-6 text-sm text-stone-400">Consultando horarios…</p>
          ) : dayInfo && !dayInfo.working ? (
            <div className="card mt-4 text-center">
              <p className="text-3xl">😴</p>
              <p className="mt-2 font-semibold">
                {dayInfo.reason === "closed" && "El barbero no trabaja este día."}
                {dayInfo.reason === "blocked" && "El barbero no tiene disponibilidad para esta fecha."}
                {dayInfo.reason === "max_advance" && "Esta fecha está fuera del rango de reserva."}
                {dayInfo.reason === "past" && "No puedes elegir una fecha pasada."}
              </p>
              <button onClick={() => setStep(1)} className="btn-ghost btn-sm mt-4">Elegir otra fecha</button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {dayInfo?.slots.map((s) => {
                const occupied = s.status === "occupied";
                const blocked = s.status === "blocked";
                const past = s.status === "past";
                const selected = slot?.startMin === s.startMin;
                return (
                  <button
                    key={s.startMin}
                    disabled={occupied || blocked || past}
                    onClick={() => {
                      setSlot(s);
                      setStep(3);
                    }}
                    className={`rounded-xl border px-2 py-3 text-center text-sm font-bold transition ${
                      selected
                        ? "border-brand-500 bg-brand-500 text-stone-950"
                        : occupied
                          ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 line-through dark:border-stone-800 dark:bg-stone-900"
                          : blocked
                            ? "cursor-not-allowed border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : past
                              ? "cursor-not-allowed border-stone-200 text-stone-300 dark:border-stone-800 dark:text-stone-600"
                              : "border-stone-300 bg-white hover:border-brand-500 dark:border-stone-700 dark:bg-stone-900"
                    }`}
                  >
                    {s.label}
                    <span className="block text-[9px] font-semibold uppercase tracking-wide">
                      {occupied ? "Ocupado" : blocked ? "Bloqueado" : past ? "Pasado" : "Disponible"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {dayInfo && dayInfo.working && dayInfo.slots.length === 0 && !loading && (
            <p className="mt-4 text-sm text-stone-400">No hay horarios disponibles para este servicio ese día.</p>
          )}
          <button onClick={() => setStep(1)} className="btn-ghost btn-sm mt-4">← Cambiar fecha</button>
        </div>
      )}

      {/* STEP 3: details */}
      {step === 3 && (
        <div className="animate-fade-up">
          <div className="card mb-4 flex items-center justify-between bg-brand-500/10">
            <div>
              <p className="font-black uppercase">{service?.name}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {dayInfo?.date} · {slot?.label} · {service?.durationMin} min
              </p>
            </div>
            <p className="text-xl font-black text-brand-500">{money(service?.price ?? 0)}</p>
          </div>
          <h2 className="text-xl font-black uppercase">4. Tus datos</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="label">Nombre completo *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Juan Pérez" />
            </div>
            <div>
              <label className="label">Teléfono / WhatsApp *</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="300 123 4567" inputMode="tel" />
            </div>
            <div>
              <label className="label">Correo electrónico (opcional)</label>
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="juan@correo.com" inputMode="email" />
            </div>
            <div>
              <label className="label">Observaciones (opcional)</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ej: prefiero fade bajo, soy nuevo" />
            </div>
            <button onClick={submit} disabled={submitting} className="btn-primary w-full py-4 text-base uppercase tracking-widest">
              {submitting ? "Confirmando…" : "Confirmar reserva"}
            </button>
            <button onClick={() => setStep(2)} className="btn-ghost w-full">← Cambiar hora</button>
            <p className="text-center text-xs text-stone-400">No necesitas crear una cuenta. Al confirmar, el horario queda reservado para ti.</p>
          </div>
        </div>
      )}

      {/* STEP 4: confirm (summary) */}
      {step === 4 && (
        <div className="animate-fade-up card p-6">
          <h2 className="text-xl font-black uppercase">5. Confirma tu reserva</h2>
          <div className="mt-4 space-y-3">
            {[
              ["Servicio", service?.name ?? ""],
              ["Fecha", date ?? ""],
              ["Hora", slot?.label ?? ""],
              ["Duración", `${service?.durationMin} min`],
              ["Valor", money(service?.price ?? 0)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-stone-100 pb-2 dark:border-stone-800">
                <span className="text-sm text-stone-500">{k}</span>
                <span className="text-sm font-bold">{v}</span>
              </div>
            ))}
            <div className="grid gap-2 pt-2">
              <button onClick={submit} disabled={submitting} className="btn-primary w-full py-3.5 uppercase tracking-widest">
                {submitting ? "Reservando…" : "✅ Sí, confirmar"}
              </button>
              <button onClick={() => setStep(3)} className="btn-ghost w-full">← Editar datos</button>
            </div>
          </div>
        </div>
      )}

      {/* footer */}
      <div className="mt-8 text-center text-xs text-stone-400">
        <button onClick={() => router.push("/")} className="inline-block py-2 underline">← Volver al inicio</button>
      </div>
      <BrandFooter className="mt-2" />
    </main>
  );
}
