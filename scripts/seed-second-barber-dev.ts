/* eslint-disable no-console */
// Dev-only helper: creates a second barbero (with a working login, a couple
// of services, business hours, and a few sample appointments) in your LOCAL
// database, so you can try the multi-barber panel with two real accounts
// side by side. Never run this against production — it's for local testing.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, barbers, businessHours, clients, notifications, services, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { addDaysStr, slotToDate, slugify, todayStrInTz } from "@/lib/utils";

const NAME = "Ana Torres";
const EMAIL = "ana@test.com";
const PASSWORD = "barbero123";
const TZ = "America/Bogota";

async function main() {
  const slug = slugify(NAME);
  const existing = await db.select().from(barbers).where(eq(barbers.slug, slug)).limit(1);
  if (existing.length) {
    console.log(`Ya existe un barbero con slug "${slug}". No se creó nada nuevo.`);
    console.log(`Credenciales (si ya las tenías configuradas): ${EMAIL} / ${PASSWORD}`);
    return;
  }

  const [barber] = await db.insert(barbers).values({ name: NAME, slug, phone: "3009876543", active: true }).returning();
  await db.insert(users).values({ name: NAME, email: EMAIL, passwordHash: await hashPassword(PASSWORD), role: "barbero", barberId: barber.id });

  const svc = await db
    .insert(services)
    .values([
      { barberId: barber.id, name: "Corte rápido", price: 18000, durationMin: 25, active: true, sort: 1 },
      { barberId: barber.id, name: "Corte + barba", price: 32000, durationMin: 45, active: true, sort: 2 },
    ])
    .returning();

  const hours = [];
  for (let wd = 1; wd <= 6; wd++) hours.push({ barberId: barber.id, weekday: wd, startMin: 9 * 60, endMin: 18 * 60 });
  await db.insert(businessHours).values(hours);

  const people = [
    { name: "Laura Gómez", phone: "3011112222" },
    { name: "Kevin Ríos", phone: "3022223333" },
  ];
  const clientRows = await db.insert(clients).values(people.map((p) => ({ ...p, barberId: barber.id }))).returning();

  const today = todayStrInTz(TZ);
  const start1 = slotToDate(today, 10 * 60, TZ);
  await db.insert(appointments).values({
    code: `BAR2-${today.replace(/-/g, "")}-0001`,
    barberId: barber.id,
    clientId: clientRows[0].id,
    serviceId: svc[0].id,
    serviceName: svc[0].name,
    price: svc[0].price,
    durationMin: svc[0].durationMin,
    startTime: start1,
    endTime: slotToDate(today, 10 * 60 + svc[0].durationMin, TZ),
    status: "confirmada",
    createdBy: "cliente",
  });

  const tomorrow = addDaysStr(today, 1);
  const start2 = slotToDate(tomorrow, 14 * 60, TZ);
  await db.insert(appointments).values({
    code: `BAR2-${tomorrow.replace(/-/g, "")}-0001`,
    barberId: barber.id,
    clientId: clientRows[1].id,
    serviceId: svc[1].id,
    serviceName: svc[1].name,
    price: svc[1].price,
    durationMin: svc[1].durationMin,
    startTime: start2,
    endTime: slotToDate(tomorrow, 14 * 60 + svc[1].durationMin, TZ),
    status: "pendiente",
    createdBy: "cliente",
  });

  await db.insert(notifications).values({
    barberId: barber.id,
    type: "system",
    title: "🔔 Bienvenida",
    body: "Tu panel está listo. Revisa tus citas.",
    read: false,
  });

  console.log("Listo. Segundo barbero creado con datos de ejemplo.");
  console.log(`Nombre: ${NAME} (/${slug})`);
  console.log(`Login: ${EMAIL} / ${PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
