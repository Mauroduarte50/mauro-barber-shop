import Image from "next/image";
import Link from "next/link";
import { getBarberBySlug, getDefaultBarber, getAppSettings, getActiveServices } from "@/lib/settings";
import { minutesToLabel, money, waLink } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default async function HomePage() {
  const barber = (await getDefaultBarber()) ?? (await getBarberBySlug("mauro-barber"));
  const settings = await getAppSettings(barber?.id ?? "");
  const services = barber ? await getActiveServices(barber.id) : [];

  const hoursRows = barber
    ? await (async () => {
        const { db } = await import("@/db");
        const { businessHours } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        return db.select().from(businessHours).where(eq(businessHours.barberId, barber.id));
      })()
    : [];
  const byDay = new Map<number, { startMin: number; endMin: number }[]>();
  for (const r of hoursRows) {
    const arr = byDay.get(r.weekday) ?? [];
    arr.push({ startMin: r.startMin, endMin: r.endMin });
    byDay.set(r.weekday, arr);
  }
  const dayNames = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const today = new Date().getDay() === 0 ? 7 : new Date().getDay();

  const bookingUrl = `${SITE_URL}/reservar`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=16&color=0-0-0&bgcolor=255-255-255&data=${encodeURIComponent(bookingUrl)}`;

  return (
    <main className="min-h-screen">
      {/* HERO */}
      <section className="relative flex min-h-[92svh] flex-col justify-end overflow-hidden">
        <Image
          src="/images/hero.jpg"
          alt="Interior de la barbería"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/60 to-stone-950/20" />
        <div className="relative mx-auto w-full max-w-5xl px-5 pb-16 pt-24">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-400/40 bg-stone-950/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-brand-300 backdrop-blur">
            ✂️ Barbería · Reservas en línea
          </p>
          <h1 className="max-w-2xl text-5xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-7xl">
            {settings.businessName}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-stone-300">{settings.businessTagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/reservar" className="btn-primary px-8 py-4 text-base uppercase tracking-widest">
              Reservar cita
            </Link>
            <a
              href={waLink(settings.businessWhatsapp, `Hola ${barber?.name ?? ""} 👋, quiero agendar una cita.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost px-8 py-4 text-base text-white dark:text-white"
            >
              💬 Reservar por WhatsApp
            </a>
          </div>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3 text-center">
            {[
              { v: `${services.filter((s) => s.active).length}+`, l: "Servicios" },
              { v: "100%", l: "Disponibilidad real" },
              { v: "24h", l: "Confirmación" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <p className="text-2xl font-black text-brand-400">{s.v}</p>
                <p className="text-xs uppercase tracking-wider text-stone-400">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BARBER */}
      {barber && (
        <section className="mx-auto max-w-5xl px-5 py-16">
          <div className="card grid gap-6 p-6 sm:grid-cols-[220px_1fr] sm:p-8">
            <div className="relative h-64 w-full overflow-hidden rounded-2xl sm:h-full sm:min-h-[280px]">
              <Image src={barber.photo || "/images/barber.jpg"} alt={barber.name} fill className="object-cover" sizes="300px" />
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand-500">Tu barbero</p>
              <h2 className="mt-1 text-4xl font-black uppercase">{barber.name}</h2>
              <p className="mt-3 text-stone-600 dark:text-stone-300">{barber.bio || "Especialista en cortes clásicos, fades y arreglo de barba."}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/reservar" className="btn-dark">📅 Ver disponibilidad</Link>
                {settings.businessInstagram && (
                  <a href={`https://instagram.com/${settings.businessInstagram}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                    📸 Instagram
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SERVICES */}
      <section id="servicios" className="mx-auto max-w-5xl px-5 pb-16">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand-500">Servicios</p>
          <h2 className="mt-1 text-3xl font-black uppercase sm:text-4xl">Elige tu estilo</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services
            .filter((s) => s.active)
            .map((s) => (
              <div key={s.id} className="card group relative flex flex-col p-6 transition hover:-translate-y-1 hover:shadow-xl">
                <div className="text-3xl">✂️</div>
                <h3 className="mt-3 text-xl font-black uppercase">{s.name}</h3>
                {s.description && <p className="mt-1 flex-1 text-sm text-stone-500 dark:text-stone-400">{s.description}</p>}
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-stone-400">Duración</p>
                    <p className="font-semibold">{s.durationMin} min</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wider text-stone-400">Precio</p>
                    <p className="text-xl font-black text-brand-500">{money(s.price)}</p>
                  </div>
                </div>
                <Link href={`/reservar?service=${s.id}`} className="btn-primary mt-5 w-full">
                  Reservar
                </Link>
              </div>
            ))}
        </div>
      </section>

      {/* HOURS */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="card p-6 sm:p-8">
          <h2 className="text-2xl font-black uppercase">Horarios disponibles</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {dayNames.slice(1).map((name, i) => {
              const wd = i + 1;
              const arr = byDay.get(wd);
              const isToday = wd === today;
              return (
                <div
                  key={wd}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                    isToday ? "border-brand-500/50 bg-brand-500/10" : "border-stone-200 dark:border-stone-800"
                  }`}
                >
                  <span className="font-semibold">{name}{isToday && <span className="ml-2 text-[10px] font-bold uppercase text-brand-500">Hoy</span>}</span>
                  <span className="text-sm text-stone-500 dark:text-stone-400">
                    {arr && arr.length ? arr.map((b) => `${minutesToLabel(b.startMin)} – ${minutesToLabel(b.endMin)}`).join(" / ") : "Descanso"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CONTACT + FIND BOOKING + QR */}
      <section className="mx-auto max-w-5xl px-5 pb-20">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="card p-6">
            <h3 className="text-lg font-black uppercase">📍 Ubicación</h3>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{settings.businessAddress}</p>
            <p className="mt-2 text-sm font-semibold">{settings.businessPhone}</p>
          </div>
          <div className="card p-6">
            <h3 className="text-lg font-black uppercase">🔎 Busca tu cita</h3>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">Consulta, cancela o reprograma con tu código (ej. BAR-20260815-0042).</p>
            <form action="/cita/buscar" method="get" className="mt-3 flex gap-2">
              <input name="code" required placeholder="Código de reserva" className="input" />
              <button className="btn-dark">Buscar</button>
            </form>
          </div>
          <div className="card flex flex-col items-center p-6 text-center">
            <h3 className="text-lg font-black uppercase">📲 Escanea y reserva</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="QR de reservas" width={150} height={150} className="mt-3 rounded-xl bg-white p-2" />
            <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm mt-3">
              Descargar QR
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-stone-200 bg-stone-900 py-16 text-center dark:border-stone-800">
        <h2 className="px-5 text-3xl font-black uppercase text-white sm:text-4xl">¿Listo para un cambio de look?</h2>
        <p className="mt-2 text-stone-400">{settings.businessTagline}</p>
        <Link href="/reservar" className="btn-primary mt-6 px-10 py-4 text-base uppercase tracking-widest">
          Reservar cita
        </Link>
      </section>

      <footer className="bg-stone-950 py-8 text-center text-sm text-stone-500">
        © {new Date().getFullYear()} {settings.businessName} · Hecho con ✂️ en Colombia
      </footer>
    </main>
  );
}
