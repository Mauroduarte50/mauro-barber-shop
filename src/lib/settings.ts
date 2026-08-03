import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { settings as settingsTable, barbers, services, type Barber, type User } from "@/db/schema";
import { DEFAULT_TZ } from "@/lib/utils";

export const DEFAULT_SETTINGS: Record<string, string> = {
  business_name: "Tu Barbería",
  business_tagline: "Estilo clásico, cortes de precisión.",
  business_description: "Barbería moderna especializada en cortes clásicos, fades y arreglo de barba.",
  business_address: "Cra 15 # 82 - 40, Bogotá, Colombia",
  business_phone: "+57 300 123 4567",
  business_whatsapp: "+57 300 123 4567",
  business_instagram: "",
  business_facebook: "",
  currency: "COP",
  timezone: DEFAULT_TZ,
  cancellation_policy: "Puedes cancelar tu cita hasta 2 horas antes sin costo.",
  cancel_window_min: "120",
  min_advance_min: "30",
  max_advance_days: "30",
  gap_min: "10",
  slot_step: "15",
  reminders_enabled: "true",
  site_url: "",
};

/**
 * Shared business identity — one shop, admin-only, stored with a NULL
 * `barberId` (the "global settings" row the schema was designed for).
 */
export const GLOBAL_SETTING_KEYS = [
  "business_name",
  "business_tagline",
  "business_description",
  "business_address",
  "business_phone",
  "business_whatsapp",
  "business_instagram",
  "business_facebook",
  "currency",
  "timezone",
  "cancellation_policy",
  "site_url",
] as const;

/** Booking rules each barber configures for themselves. */
export const BARBER_SETTING_KEYS = [
  "cancel_window_min",
  "min_advance_min",
  "max_advance_days",
  "gap_min",
  "slot_step",
  "reminders_enabled",
] as const;

export interface AppSettings {
  businessName: string;
  businessTagline: string;
  businessDescription: string;
  businessAddress: string;
  businessPhone: string;
  businessWhatsapp: string;
  businessInstagram: string;
  businessFacebook: string;
  currency: string;
  timezone: string;
  cancellationPolicy: string;
  cancelWindowMin: number;
  minAdvanceMin: number;
  maxAdvanceDays: number;
  gapMin: number;
  slotStep: number;
  remindersEnabled: boolean;
  siteUrl: string;
}

export async function getSettingsMap(barberId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.barberId, barberId));
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function getGlobalSettingsMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable).where(isNull(settingsTable.barberId));
  const map: Record<string, string> = {};
  for (const key of GLOBAL_SETTING_KEYS) map[key] = DEFAULT_SETTINGS[key];
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function saveGlobalSettings(obj: Record<string, string>): Promise<void> {
  const allowed = new Set<string>(GLOBAL_SETTING_KEYS);
  for (const [key, value] of Object.entries(obj)) {
    if (!allowed.has(key)) continue;
    const existing = await db
      .select({ id: settingsTable.id })
      .from(settingsTable)
      .where(and(isNull(settingsTable.barberId), eq(settingsTable.key, key)))
      .limit(1);
    if (existing.length) {
      await db.update(settingsTable).set({ value }).where(eq(settingsTable.id, existing[0].id));
    } else {
      await db.insert(settingsTable).values({ barberId: null, key, value });
    }
  }
}

/**
 * Merges the shared business identity (global, NULL-`barberId` rows) with
 * this barber's own booking rules — the two key sets never overlap, so
 * merge order doesn't matter.
 */
export async function getAppSettings(barberId: string): Promise<AppSettings> {
  const [global, perBarber] = await Promise.all([getGlobalSettingsMap(), getSettingsMap(barberId)]);
  // Global keys always come from the shared row, never from a barber's own
  // map (which, pre-migration or from a stale write, could still hold a
  // leftover value for a global key and silently mask the shared one).
  const m: Record<string, string> = { ...global };
  for (const key of BARBER_SETTING_KEYS) m[key] = perBarber[key];
  return {
    businessName: m.business_name,
    businessTagline: m.business_tagline,
    businessDescription: m.business_description,
    businessAddress: m.business_address,
    businessPhone: m.business_phone,
    businessWhatsapp: m.business_whatsapp,
    businessInstagram: m.business_instagram,
    businessFacebook: m.business_facebook,
    currency: m.currency,
    timezone: m.timezone || DEFAULT_TZ,
    cancellationPolicy: m.cancellation_policy,
    cancelWindowMin: Number(m.cancel_window_min) || 120,
    minAdvanceMin: Number(m.min_advance_min) || 30,
    maxAdvanceDays: Number(m.max_advance_days) || 30,
    gapMin: Number(m.gap_min) || 10,
    slotStep: Number(m.slot_step) || 15,
    remindersEnabled: m.reminders_enabled !== "false",
    siteUrl: m.site_url,
  };
}

export async function saveSettings(barberId: string, obj: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(obj)) {
    const existing = await db
      .select({ id: settingsTable.id })
      .from(settingsTable)
      .where(and(eq(settingsTable.barberId, barberId), eq(settingsTable.key, key)))
      .limit(1);
    if (existing.length) {
      await db
        .update(settingsTable)
        .set({ value })
        .where(eq(settingsTable.id, existing[0].id));
    } else {
      await db.insert(settingsTable).values({ barberId, key, value });
    }
  }
}

/** Same as `saveSettings`, but only ever writes booking-rule keys — a
 * barber (or a manipulated request) can never smuggle a global business-
 * identity key into their own per-barber row this way. */
export async function saveBarberSettings(barberId: string, obj: Record<string, string>): Promise<void> {
  const allowed = new Set<string>(BARBER_SETTING_KEYS);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) if (allowed.has(key)) filtered[key] = value;
  await saveSettings(barberId, filtered);
}

/** Resolve the active barber (first by default — multi-barber ready). */
export async function getDefaultBarber(): Promise<Barber | null> {
  const rows = await db.select().from(barbers).where(eq(barbers.active, true)).limit(1);
  return rows[0] ?? null;
}

export async function getBarberBySlug(slug: string): Promise<Barber | null> {
  const rows = await db.select().from(barbers).where(eq(barbers.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getBarberById(id: string): Promise<Barber | null> {
  const rows = await db.select().from(barbers).where(eq(barbers.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * The barber a logged-in user acts as: their own linked barber if they have
 * one (every `barbero` account, plus an `admin` who is also a working
 * barber), otherwise the first active barber (today's single-barber
 * default, kept for admins with no barber of their own).
 */
export async function resolveOwnBarber(user: User): Promise<Barber | null> {
  if (user.barberId) return getBarberById(user.barberId);
  return getDefaultBarber();
}

export async function getActiveServices(barberId: string) {
  return db
    .select()
    .from(services)
    .where(eq(services.barberId, barberId))
    .orderBy(services.sort);
}
