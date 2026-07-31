"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { money, waLink } from "@/lib/utils";

interface Booking {
  id: string;
  code: string;
  serviceName: string;
  price: number;
  durationMin: number;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  rescheduledFrom: string | null;
  clientName: string;
  clientPhone: string;
  barberName: string;
  barberPhone: string;
  businessName: string;
  businessWhatsapp: string;
  cancellationPolicy: string;
  cancelWindowMin: number;
  tz: string;
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
  status: string;
}

const STATUS_BADGE: Record<string, string> = {
  pendiente: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  confirmada: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  en_espera: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  atendida: "bg-stone-500/15 text-stone-600 dark:text-stone-300",
  cancelada: "bg-red-500/15 text-red-600 dark:text-red-400",
  no_asistio: "bg-stone-500/15 text-stone-500",
};

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .replace(/\//g, "-");
}

export default function ManageAppointmentPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center"><p className="text-stone-400">Cargando…</p></main>}>
      <ManageAppointment />
    </Suspense>
  );
}

function ManageAppointment() {
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"none" | "cancel" | "reschedule">("none");
  const [days, setDays] = useState<DaySummary[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [dayInfo, setDayInfo] = useState<{ slots: Slot[] } | null>(null);
  const [newSlot, setNewSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookupMode, setLookupMode] = useState(false);
  const [lookup, setLookup] = useState({ query: "", type: "code" as "code" | "phone" });
  const [lookupResults, setLookupResults] = useState<{ code: string; serviceName: string; startTime: string; status: string }[]>([]);

  const tz = booking?.tz ?? "America/Bogota";

  const load = useCallback(async (code: string) => {
    setLoading(true);
    setNotFound(false);
    try {
      const r = await fetch(`/api/public/bookings/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (r.status === 404) {
        setNotFound(true);
        setBooking(null);
        return;
      }
      const data = await r.json();
      setBooking(data.booking);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const code = searchParams.get("code");
    if (params.code && params.code !== "buscar") load(params.code);
    else if (code) load(code);
    else setLookupMode(true);
  }, [params.code, searchParams, load]);

  const doLookup = async () => {
    setError("");
    if (lookup.type === "code") {
      await load(lookup.query.trim());
    } else {
      const r = await fetch(`/api/public/bookings?phone=${encodeURIComponent(lookup.query.trim())}`, { cache: "no-store" });
      const data = await r.json();
      setLookupResults(data.bookings ?? []);
    }
  };

  const cancel = async () => {
    if (!booking) return;
    setBusy(true);
    setError("");
    const r = await fetch(`/api/public/bookings/${booking.code}`, { method: "DELETE" });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(data.error || "No se pudo cancelar.");
      return;
    }
    setAction("none");
    await load(booking.code);
  };

  const loadDays = async () => {
    if (!booking) return;
    const r = await fetch(`/api/public/availability?range=30&duration=${booking.durationMin}`, { cache: "no-store" });
    const data = await r.json();
    setDays(data.days ?? []);
  };

  const selectDate = async (d: string) => {
    if (!booking) return;
    setDate(d);
    setNewSlot(null);
    const r = await fetch(`/api/public/availability?date=${d}&duration=${booking.durationMin}`, { cache: "no-store" });
    const data = await r.json();
    setDayInfo(data);
  };

  const reschedule = async () => {
    if (!booking || !date || !newSlot) return;
    setBusy(true);
    setError("");
    const r = await fetch(`/api/public/bookings/${booking.code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, startMin: newSlot.startMin, phone: booking.clientPhone }),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(data.error || "No se pudo reprogramar.");
      return;
    }
    setAction("none");
    await load(booking.code);
  };

  const dateChips = useMemo(
    () =>
      days.map((d) => {
        const [y, m, dd] = d.date.split("-").map(Number);
        const label = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, dd)));
        return { ...d, label, isToday: d.date === todayInTz(tz) };
      }),
    [days, tz],
  );

  /* ---------- lookup mode ---------- */
  if (lookupMode && !booking) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-10">
        <div className="card p-6">
          <h1 className="text-2xl font-black uppercase">🔎 Buscar mi cita</h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Ingresa el código de reserva o tu número de teléfono.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setLookup({ ...lookup, type: "code" })} className={`btn btn-sm flex-1 ${lookup.type === "code" ? "btn-dark" : "btn-ghost"}`}>Código</button>
            <button onClick={() => setLookup({ ...lookup, type: "phone" })} className={`btn btn-sm flex-1 ${lookup.type === "phone" ? "btn-dark" : "btn-ghost"}`}>Teléfono</button>
          </div>
          <input
            className="input mt-3"
            value={lookup.query}
            onChange={(e) => setLookup({ ...lookup, query: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && doLookup()}
            placeholder={lookup.type === "code" ? "BAR-20260815-0042" : "300 123 4567"}
          />
          <button onClick={doLookup} className="btn-primary mt-3 w-full">Buscar</button>
          {lookupResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {lookupResults.map((b) => (
                <Link key={b.code} href={`/cita/${b.code}`} className="card block p-3 transition hover:border-brand-500">
                  <p className="font-bold">{b.code}</p>
                  <p className="text-sm text-stone-500">{b.serviceName} · {new Date(b.startTime).toLocaleDateString("es-CO")}</p>
                </Link>
              ))}
            </div>
          )}
          {lookup.type === "phone" && lookupResults.length === 0 && lookup.query && (
            <p className="mt-3 text-sm text-stone-400">No se encontraron reservas con ese teléfono.</p>
          )}
          <Link href="/" className="btn-ghost mt-4 w-full">← Volver al inicio</Link>
        </div>
      </main>
    );
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center"><p className="text-stone-400">Cargando…</p></main>;

  if (notFound || !booking) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5 text-center">
        <p className="text-5xl">🔍</p>
        <h1 className="mt-3 text-2xl font-black uppercase">Reserva no encontrada</h1>
        <p className="mt-2 text-sm text-stone-400">Verifica el código e intenta de nuevo.</p>
        <Link href="/cita/buscar" className="btn-primary mt-5">Buscar otra cita</Link>
        <Link href="/" className="btn-ghost mt-2">← Inicio</Link>
      </main>
    );
  }

  const start = new Date(booking.startTime);
  const canCancel = booking.status !== "cancelada" && booking.status !== "atendida" && booking.status !== "no_asistio";
  const canReschedule = canCancel;

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 py-10">
      <Link href="/" className="inline-block py-2 text-sm text-stone-400 underline">← Inicio</Link>
      <div className="animate-fade-up card mt-4 overflow-hidden">
        <div className="border-b border-stone-200 bg-stone-900 p-6 dark:border-stone-800">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand-400">Tu cita</p>
          <h1 className="mt-1 text-3xl font-black uppercase text-white">{booking.serviceName}</h1>
          <span className={`chip mt-3 ${STATUS_BADGE[booking.status] ?? ""}`}>{booking.status.toUpperCase()}</span>
        </div>
        <div className="space-y-3 p-6">
          {[
            ["Código", booking.code],
            ["Cliente", booking.clientName],
            ["Barbero", booking.barberName],
            ["Fecha", start.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })],
            ["Hora", start.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })],
            ["Duración", `${booking.durationMin} min`],
            ["Valor", money(booking.price)],
            ["Estado", booking.status],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-stone-100 pb-2 last:border-0 dark:border-stone-800">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-400">{k}</span>
              <span className="text-sm font-bold capitalize">{v}</span>
            </div>
          ))}
          {booking.rescheduledFrom && (
            <p className="text-xs text-stone-400">Originalmente: {new Date(booking.rescheduledFrom).toLocaleString("es-CO")}</p>
          )}
          {booking.cancelledAt && (
            <p className="text-xs text-red-500">Cancelada el {new Date(booking.cancelledAt).toLocaleString("es-CO")} por {booking.cancelledBy}</p>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</div>
          )}

          {action === "none" && (
            <div className="grid gap-2 pt-2">
              <a href={waLink(booking.businessWhatsapp || booking.barberPhone, `Hola ${booking.barberName} 👋, tengo la cita ${booking.code}.`)} target="_blank" rel="noopener noreferrer" className="btn-dark w-full">
                💬 Contactar por WhatsApp
              </a>
              {canReschedule && (
                <button onClick={() => { setAction("reschedule"); setError(""); loadDays(); }} className="btn-ghost w-full">🔄 Reprogramar cita</button>
              )}
              {canCancel && (
                <button onClick={() => setAction("cancel")} className="btn-ghost w-full text-red-500 dark:text-red-400">✕ Cancelar cita</button>
              )}
            </div>
          )}

          {action === "cancel" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm font-semibold">¿Seguro que deseas cancelar tu cita?</p>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Política: {booking.cancellationPolicy}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={cancel} disabled={busy} className="btn-danger flex-1">{busy ? "Cancelando…" : "Sí, cancelar"}</button>
                <button onClick={() => setAction("none")} className="btn-ghost flex-1">Volver</button>
              </div>
            </div>
          )}

          {action === "reschedule" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Elige un nuevo horario</p>
              {!date && (
                <div className="scrollbar-hide -mx-2 flex gap-2 overflow-x-auto px-2 pb-1">
                  {dateChips.map((d) => (
                    <button
                      key={d.date}
                      disabled={!d.working}
                      onClick={() => selectDate(d.date)}
                      className={`flex w-[80px] shrink-0 flex-col items-center rounded-xl border px-2 py-2.5 ${
                        d.working ? "border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900" : "border-stone-200 opacity-40 dark:border-stone-800"
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase">{d.isToday ? "Hoy" : d.label.split(" ")[0]}</span>
                      <span className="text-xl font-black">{d.label.split(" ")[1]}</span>
                      <span className="text-[10px] font-semibold text-brand-500">{d.working ? `${d.count}` : "—"}</span>
                    </button>
                  ))}
                </div>
              )}
              {date && (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {dayInfo?.slots
                      .filter((s) => s.status === "available")
                      .map((s) => (
                        <button
                          key={s.startMin}
                          onClick={() => setNewSlot(s)}
                          className={`rounded-xl border px-2 py-2.5 text-sm font-bold ${
                            newSlot?.startMin === s.startMin ? "border-brand-500 bg-brand-500 text-stone-950" : "border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                  </div>
                  {dayInfo && dayInfo.slots.filter((s) => s.status === "available").length === 0 && (
                    <p className="text-sm text-stone-400">Sin horarios libres ese día.</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={reschedule} disabled={busy || !newSlot} className="btn-primary flex-1">{busy ? "Reprogramando…" : "Confirmar nuevo horario"}</button>
                    <button onClick={() => { setDate(null); setNewSlot(null); }} className="btn-ghost">←</button>
                  </div>
                </>
              )}
              <button onClick={() => setAction("none")} className="text-xs text-stone-400 underline">Cancelar acción</button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
