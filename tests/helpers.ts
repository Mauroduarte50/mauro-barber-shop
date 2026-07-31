import { eq } from "drizzle-orm";
import { db } from "@/db";
import { barbers, businessHours, breaks, services, settings, type Barber, type Service } from "@/db/schema";

export const TEST_SLUG = "test-barber-vitest";

export interface TestFixture {
  barber: Barber;
  service30: Service;
  service60: Service;
}

/** Creates an isolated barber (own hours/services/settings) so tests never touch seeded data. */
export async function setupTestBarber(): Promise<TestFixture> {
  await teardownTestBarber();

  const [barber] = await db
    .insert(barbers)
    .values({ name: "Test Barber", slug: TEST_SLUG, active: true })
    .returning();

  const [service30, service60] = await db
    .insert(services)
    .values([
      { barberId: barber.id, name: "Test 30min", price: 10000, durationMin: 30, active: true, sort: 1 },
      { barberId: barber.id, name: "Test 60min", price: 20000, durationMin: 60, active: true, sort: 2 },
    ])
    .returning();

  // Open every day 08:00-20:00 so tests aren't weekday-dependent.
  const hourRows = [];
  for (let wd = 1; wd <= 7; wd++) hourRows.push({ barberId: barber.id, weekday: wd, startMin: 8 * 60, endMin: 20 * 60 });
  await db.insert(businessHours).values(hourRows);

  // A recurring lunch break on every weekday for the "no booking during break" test.
  for (let wd = 1; wd <= 5; wd++) {
    await db.insert(breaks).values({ barberId: barber.id, weekday: wd, startMin: 12 * 60, endMin: 13 * 60, label: "Almuerzo" });
  }

  await db.insert(settings).values(
    Object.entries({
      min_advance_min: "0",
      max_advance_days: "365",
      gap_min: "10",
      slot_step: "15",
      cancel_window_min: "120",
      timezone: "America/Bogota",
    }).map(([key, value]) => ({ barberId: barber.id, key, value })),
  );

  return { barber, service30, service60 };
}

export async function teardownTestBarber(): Promise<void> {
  // FKs cascade: deleting the barber cleans up services/clients/appointments/
  // business_hours/breaks/blocked_slots/notifications/payments/settings.
  await db.delete(barbers).where(eq(barbers.slug, TEST_SLUG));
}
