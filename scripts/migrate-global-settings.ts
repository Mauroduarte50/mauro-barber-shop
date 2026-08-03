/* eslint-disable no-console */
// One-off, idempotent backfill for the general-settings split (Phase 3):
// copies the shared business-identity keys (business_name, whatsapp, etc.)
// from the existing barber's per-barber settings rows into the new global
// rows (barber_id IS NULL), then removes the old per-barber copies so they
// can never mask a later edit to the global row. Refuses to guess if
// there's more than one barber — copy manually in that case.
import "dotenv/config";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { barbers, settings } from "@/db/schema";
import { GLOBAL_SETTING_KEYS } from "@/lib/settings";

async function main() {
  const existingGlobal = await db.select().from(settings).where(isNull(settings.barberId));
  if (existingGlobal.length) {
    console.log(`Ya existen ${existingGlobal.length} filas de configuración general. Nada que hacer.`);
    return;
  }

  const allBarbers = await db.select().from(barbers);
  if (allBarbers.length !== 1) {
    console.error(
      `Hay ${allBarbers.length} barberos en la base de datos (se esperaba exactamente 1 para copiar automáticamente sin ambigüedad).`,
    );
    console.error("Copia manualmente los valores de negocio a filas con barber_id NULL antes de continuar.");
    process.exit(1);
  }

  const [barber] = allBarbers;
  const keys = [...GLOBAL_SETTING_KEYS];
  const rows = await db
    .select()
    .from(settings)
    .where(and(eq(settings.barberId, barber.id), inArray(settings.key, keys)));

  for (const r of rows) {
    await db.insert(settings).values({ barberId: null, key: r.key, value: r.value });
    console.log(`Copiado "${r.key}" a configuración general.`);
  }
  if (rows.length) {
    await db.delete(settings).where(and(eq(settings.barberId, barber.id), inArray(settings.key, keys)));
    console.log(`Eliminadas ${rows.length} filas antiguas de configuración general bajo el barbero "${barber.name}".`);
  }
  console.log("Listo.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
