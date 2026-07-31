import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settings as settingsTable, barbers, services, type Barber } from "@/db/schema";
import { DEFAULT_TZ } from "@/lib/utils";

export const DEFAULT_SETTINGS: Record<string, string> = {
  business_name: "MAURO BARBER SHOP",
  business_tagline: "Estilo clásico, cortes de precisión.",
  business_description: "Barbería moderna especializada en cortes clásicos, fades y arreglo de barba.",
  business_address: "Cra 15 # 82 - 40, Bogotá, Colombia",
  business_phone: "+57 300 123 4567",
  business_whatsapp: "+57 300 123 4567",
  business_instagram: "maurobarber",
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

export async function getAppSettings(barberId: string): Promise<AppSettings> {
  const m = await getSettingsMap(barberId);
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

/** Resolve the active barber (first by default — multi-barber ready). */
export async function getDefaultBarber(): Promise<Barber | null> {
  const rows = await db.select().from(barbers).where(eq(barbers.active, true)).limit(1);
  return rows[0] ?? null;
}

export async function getBarberBySlug(slug: string): Promise<Barber | null> {
  const rows = await db.select().from(barbers).where(eq(barbers.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getActiveServices(barberId: string) {
  return db
    .select()
    .from(services)
    .where(eq(services.barberId, barberId))
    .orderBy(services.sort);
}
