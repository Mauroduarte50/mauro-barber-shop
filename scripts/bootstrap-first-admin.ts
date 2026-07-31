/* eslint-disable no-console */
// One-off bootstrap for a fresh production database: creates exactly one
// admin user and one barber, no seed/demo data. Safe to re-run — it's a
// no-op if a user with that email already exists.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { barbers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { slugify } from "@/lib/utils";

const ADMIN_NAME = process.argv[2];
const ADMIN_EMAIL = process.argv[3];
const ADMIN_PASSWORD = process.argv[4];
const BARBER_NAME = process.argv[5];

async function main() {
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || !BARBER_NAME) {
    console.error("Usage: tsx scripts/bootstrap-first-admin.ts <adminName> <adminEmail> <adminPassword> <barberName>");
    process.exit(1);
  }

  const existingUser = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (existingUser.length) {
    console.log(`Ya existe un usuario con ese correo (${ADMIN_EMAIL}); no se creó ninguno nuevo.`);
  } else {
    await db.insert(users).values({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: "admin",
    });
    console.log(`Usuario admin creado: ${ADMIN_EMAIL}`);
  }

  const slug = slugify(BARBER_NAME);
  const existingBarber = await db.select().from(barbers).where(eq(barbers.slug, slug)).limit(1);
  if (existingBarber.length) {
    console.log(`Ya existe un barbero con slug "${slug}"; no se creó ninguno nuevo.`);
  } else {
    await db.insert(barbers).values({ name: BARBER_NAME, slug, active: true });
    console.log(`Barbero creado: ${BARBER_NAME} (/${slug})`);
  }

  console.log("Listo. No se insertaron servicios, horarios ni datos de ejemplo — configúralos desde /admin.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
