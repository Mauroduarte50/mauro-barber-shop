/* eslint-disable no-console */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  auditLogs,
  barbers,
  blockedSlots,
  breaks,
  businessHours,
  clients,
  notifications,
  payments,
  services,
  settings as settingsTable,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { addDaysStr, slotToDate, todayStrInTz } from "@/lib/utils";

const TZ = "America/Bogota";

async function main() {
  console.log("Seeding…");
  // wipe in dependency order
  await db.delete(payments);
  await db.delete(appointments);
  await db.delete(notifications);
  await db.delete(blockedSlots);
  await db.delete(breaks);
  await db.delete(businessHours);
  await db.delete(services);
  await db.delete(clients);
  await db.delete(settingsTable);
  await db.delete(barbers);
  await db.delete(auditLogs);
  await db.delete(users);

  const [barber] = await db
    .insert(barbers)
    .values({
      name: "Tu Barbero",
      slug: "barbero-principal",
      bio: "Barbero profesional con más de 8 años de experiencia. Especialista en fades, cortes clásicos y arreglo de barba.",
      photo: "/images/barber.jpg",
      phone: "+57 300 123 4567",
      instagram: "",
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      name: "Administrador",
      email: "admin@barberia.com",
      passwordHash: await hashPassword("admin123"),
      role: "admin",
      barberId: barber.id,
    })
    .returning({ id: users.id, name: users.name });

  const svc = [
    { name: "Corte clásico", description: "Corte a tijera o máquina con acabado", price: 20000, durationMin: 30, sort: 1 },
    { name: "Barba clásica", description: "Perfilado y afeitado con toalla caliente", price: 15000, durationMin: 20, sort: 2 },
    { name: "Corte + barba", description: "El combo completo del caballero", price: 30000, durationMin: 50, sort: 3 },
    { name: "Corte premium", description: "Corte + barba + lavado + masaje capilar", price: 40000, durationMin: 60, sort: 4 },
  ];
  const inserted = await db
    .insert(services)
    .values(svc.map((s) => ({ ...s, barberId: barber.id, active: true })))
    .returning();

  // Business hours: Mon-Fri 8-12 & 14-18, Sat 8-16, Sun off
  const hours: { weekday: number; startMin: number; endMin: number }[] = [];
  for (let wd = 1; wd <= 5; wd++) {
    hours.push({ weekday: wd, startMin: 8 * 60, endMin: 12 * 60 });
    hours.push({ weekday: wd, startMin: 14 * 60, endMin: 18 * 60 });
  }
  hours.push({ weekday: 6, startMin: 8 * 60, endMin: 16 * 60 });
  await db.insert(businessHours).values(hours.map((h) => ({ ...h, barberId: barber.id })));
  await db.insert(breaks).values({ barberId: barber.id, weekday: 1, startMin: 12 * 60, endMin: 14 * 60, label: "Almuerzo" });

  // Settings
  const settings: Record<string, string> = {
    business_name: "Tu Barbería",
    business_tagline: "Estilo clásico, cortes de precisión.",
    business_description: "Barbería moderna especializada en cortes clásicos, fades y arreglo de barba.",
    business_address: "Cra 15 # 82 - 40, Bogotá, Colombia",
    business_phone: "+57 300 123 4567",
    business_whatsapp: "+57 300 123 4567",
    business_instagram: "",
    currency: "COP",
    timezone: TZ,
    cancellation_policy: "Puedes cancelar tu cita hasta 2 horas antes sin costo.",
    cancel_window_min: "120",
    min_advance_min: "30",
    max_advance_days: "30",
    gap_min: "10",
    slot_step: "15",
    reminders_enabled: "true",
  };
  await db.insert(settingsTable).values(Object.entries(settings).map(([key, value]) => ({ barberId: barber.id, key, value })));

  // Clients
  const people = [
    { name: "Carlos Pérez", phone: "3001112233" },
    { name: "Andrés Gómez", phone: "3012223344" },
    { name: "Pedro Rodríguez", phone: "3023334455" },
    { name: "María López", phone: "3034445566" },
    { name: "Juan Díaz", phone: "3045556677" },
    { name: "Santiago Rojas", phone: "3056667788" },
    { name: "Diego Castro", phone: "3067778899" },
    { name: "Felipe Mora", phone: "3078889900" },
  ];
  const clientRows = await db
    .insert(clients)
    .values(people.map((p) => ({ ...p, barberId: barber.id })))
    .returning();

  const today = todayStrInTz(TZ);
  const statuses = ["atendida", "atendida", "atendida", "cancelada", "no_asistio", "atendida", "atendida"];
  const methods = ["efectivo", "nequi", "efectivo", "daviplata", "transferencia", "efectivo", "nequi"];
  let codeSeq = 1;

  // Past 30 days of history (Mon-Sat, within work blocks)
  const startTimes = [9 * 60, 10 * 60, 11 * 60, 14 * 60 + 30, 15 * 60 + 30, 16 * 60 + 30];
  for (let d = 30; d >= 1; d--) {
    const dateStr = addDaysStr(today, -d);
    const dt = new Date(dateStr + "T00:00:00Z");
    const dow = dt.getUTCDay(); // 0 Sun
    if (dow === 0) continue;
    const count = 2 + ((d + dow) % 4); // 2-5 per day
    for (let i = 0; i < count; i++) {
      const sv = inserted[(d + i) % inserted.length];
      const startMin = startTimes[(d + i * 2) % startTimes.length];
      const client = clientRows[(d + i) % clientRows.length];
      const status = statuses[(d + i) % statuses.length];
      const start = slotToDate(dateStr, startMin, TZ);
      const end = slotToDate(dateStr, startMin + sv.durationMin, TZ);
      const code = `BAR-${dateStr.replace(/-/g, "")}-${String(codeSeq++).padStart(4, "0")}`;
      const [appt] = await db
        .insert(appointments)
        .values({
          code,
          barberId: barber.id,
          clientId: client.id,
          serviceId: sv.id,
          serviceName: sv.name,
          price: sv.price,
          durationMin: sv.durationMin,
          startTime: start,
          endTime: end,
          status,
          createdBy: "cliente",
          cancelledAt: status === "cancelada" ? new Date(start.getTime() - 3 * 3600 * 1000) : null,
          cancelledBy: status === "cancelada" ? "cliente" : null,
          paymentMethod: status === "atendida" ? methods[(d + i) % methods.length] : null,
          paid: status === "atendida",
        })
        .returning();
      if (status === "atendida") {
        await db.insert(payments).values({ appointmentId: appt.id, barberId: barber.id, amount: sv.price, method: methods[(d + i) % methods.length] });
        await db
          .update(clients)
          .set({
            totalVisits: client.totalVisits + 1,
            totalSpent: client.totalSpent + sv.price,
            firstVisit: client.firstVisit ?? start,
            lastVisit: start,
          })
          .where(eq(clients.id, client.id));
      }
    }
  }

  // Today's appointments (mix of statuses, including future ones)
  const todaySlots = [8 * 60, 9 * 60, 10 * 60, 10 * 60 + 30, 11 * 60, 14 * 60 + 30, 15 * 60, 16 * 60];
  const todayStatuses = ["confirmada", "confirmada", "en_espera", "confirmada", "pendiente", "pendiente", "confirmada", "cancelada"];
  for (let i = 0; i < todaySlots.length; i++) {
    const sv = inserted[i % inserted.length];
    const startMin = todaySlots[i];
    const client = clientRows[i % clientRows.length];
    const status = todayStatuses[i];
    const start = slotToDate(today, startMin, TZ);
    const end = slotToDate(today, startMin + sv.durationMin, TZ);
    await db
      .insert(appointments)
      .values({
        code: `BAR-${today.replace(/-/g, "")}-${String(codeSeq++).padStart(4, "0")}`,
        barberId: barber.id,
        clientId: client.id,
        serviceId: sv.id,
        serviceName: sv.name,
        price: sv.price,
        durationMin: sv.durationMin,
        startTime: start,
        endTime: end,
        status,
        createdBy: "cliente",
        cancelledAt: status === "cancelada" ? new Date() : null,
        cancelledBy: status === "cancelada" ? "barbero" : null,
        paymentMethod: status === "atendida" ? "efectivo" : null,
        paid: status === "atendida",
      })
      .catch(() => {});
  }

  // Tomorrow + future sample bookings
  const futureDays = [1, 2, 3];
  for (const fd of futureDays) {
    const dateStr = addDaysStr(today, fd);
    const dt = new Date(dateStr + "T00:00:00Z");
    if (dt.getUTCDay() === 0) continue;
    const sv = inserted[fd % inserted.length];
    const client = clientRows[fd % clientRows.length];
    const startMin = 9 * 60 + fd * 15;
    await db
      .insert(appointments)
      .values({
        code: `BAR-${dateStr.replace(/-/g, "")}-${String(codeSeq++).padStart(4, "0")}`,
        barberId: barber.id,
        clientId: client.id,
        serviceId: sv.id,
        serviceName: sv.name,
        price: sv.price,
        durationMin: sv.durationMin,
        startTime: slotToDate(dateStr, startMin, TZ),
        endTime: slotToDate(dateStr, startMin + sv.durationMin, TZ),
        status: "confirmada",
        createdBy: "cliente",
      })
      .catch(() => {});
  }

  // Blocked slot example
  const blockedDate = addDaysStr(today, 5);
  const blockedDow = new Date(blockedDate + "T00:00:00Z").getUTCDay();
  if (blockedDow !== 0) {
    await db.insert(blockedSlots).values({
      barberId: barber.id,
      date: blockedDate,
      startMin: 14 * 60,
      endMin: 15 * 60 + 30,
      reason: "Diligencia personal",
    });
  }

  await db.insert(notifications).values([
    { barberId: barber.id, type: "system", title: "🔔 Bienvenido", body: "Tu panel está listo. Revisa las citas de hoy.", read: false },
    { barberId: barber.id, type: "new_booking", title: "🔔 Nueva reserva", body: "Carlos Pérez reservó Corte + barba.", read: false },
    { barberId: barber.id, type: "cancelled", title: "Cita cancelada", body: "Un cliente canceló su cita de esta semana.", read: true },
  ]);

  await db.insert(auditLogs).values({
    userId: admin.id,
    userName: admin.name,
    action: "seed",
    details: "Base de datos inicializada con datos de demostración",
  });

  console.log("✅ Seed completo.");
  console.log("   Admin: admin@barberia.com / admin123");
  console.log(`   Barber: ${barber.name} (/${barber.slug})`);
  console.log("   Página pública: /reservar");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
