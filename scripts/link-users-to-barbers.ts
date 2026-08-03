/* eslint-disable no-console */
// One-off, idempotent backfill for the multi-barber/roles rollout: links any
// user with no `barberId` to the (single) existing barber, so the current
// admin keeps resolving to exactly the same barber as before this change.
// Refuses to guess if there's more than one barber (or none) — link those
// manually instead of risking a wrong auto-link.
import "dotenv/config";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { barbers, users } from "@/db/schema";

async function main() {
  const unlinked = await db.select().from(users).where(isNull(users.barberId));
  if (!unlinked.length) {
    console.log("Todos los usuarios ya tienen barberId asignado. Nada que hacer.");
    return;
  }

  const allBarbers = await db.select().from(barbers);
  if (allBarbers.length !== 1) {
    console.error(
      `Hay ${allBarbers.length} barberos en la base de datos (se esperaba exactamente 1 para un enlace automático seguro).`,
    );
    console.error("Vincula manualmente cada usuario a su barbero (columna users.barber_id) antes de continuar.");
    process.exit(1);
  }

  const [barber] = allBarbers;
  for (const u of unlinked) {
    await db.update(users).set({ barberId: barber.id }).where(eq(users.id, u.id));
    console.log(`Usuario "${u.email}" (rol: ${u.role}) vinculado al barbero "${barber.name}".`);
  }
  console.log("Listo.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
