import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";

export const DEFAULT_TZ = "America/Bogota";

/* ---------------- formatting ---------------- */

export function money(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

export function fmtTime(date: Date | string, tz: string): string {
  return formatInTimeZone(new Date(date), tz, "hh:mm a");
}

export function fmtDateLong(date: Date | string, tz: string): string {
  const s = formatInTimeZone(new Date(date), tz, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDateShort(date: Date | string, tz: string): string {
  return formatInTimeZone(new Date(date), tz, "yyyy-MM-dd");
}

export function fmtDateTime(date: Date | string, tz: string): string {
  return formatInTimeZone(new Date(date), tz, "dd/MM/yyyy hh:mm a");
}

/* ---------------- timezone helpers ---------------- */

export function todayStrInTz(tz: string): string {
  return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
}

/** UTC Date for local midnight of dateStr in tz. */
export function localMidnight(dateStr: string, tz: string): Date {
  return fromZonedTime(new Date(`${dateStr}T00:00:00`), tz);
}

/** UTC Date for local `startMin` (minutes from midnight) of dateStr in tz. */
export function slotToDate(dateStr: string, startMin: number, tz: string): Date {
  return new Date(localMidnight(dateStr, tz).getTime() + startMin * 60000);
}

/** ISO weekday 1=Monday .. 7=Sunday for a local date string. */
export function isoWeekdayOf(dateStr: string, tz: string): number {
  const d = localMidnight(dateStr, tz);
  return ((d.getUTCDay() + 6) % 7) + 1;
}

export function nowMinutesInTz(tz: string): number {
  const n = new Date();
  return Number(formatInTimeZone(n, tz, "H")) * 60 + Number(formatInTimeZone(n, tz, "m"));
}

/** Minutes offset local-UTC for a date in tz (America/Bogota => -300). */
export function tzOffsetMin(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  return Math.round((utcMidnight - localMidnight(dateStr, tz).getTime()) / 60000);
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const DAY_NAMES_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/* ---------------- validation helpers ---------------- */

export function sanitizeText(v: unknown, max = 500): string {
  return String(v ?? "").trim().slice(0, max);
}

export function isValidPhone(v: string): boolean {
  return /^[+]?[\d\s()-]{7,20}$/.test(v);
}

export function isValidEmail(v: string): boolean {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/* ---------------- misc ---------------- */

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function waLink(phone: string, text: string): string {
  const p = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

/** Pre-written WhatsApp thank-you message sent to a client after marking their appointment "atendida". */
export function thankYouWhatsAppMessage(clientName: string, businessName: string, barberName: string): string {
  return `¡Hola ${clientName}! Muchas gracias por tu visita a ${businessName}. Espero que te haya encantado tu corte. ¡Te esperamos pronto! — ${barberName}`;
}

export function buildICS(start: Date, end: Date, title: string, desc: string, location: string): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barberia//Reservas//ES",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@barberia`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
