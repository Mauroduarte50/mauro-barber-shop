import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments } from "@/db/schema";
import { createAppointmentTx } from "@/lib/availability";
import { addDaysStr, todayStrInTz } from "@/lib/utils";
import { setupTestBarber, teardownTestBarber, type TestFixture } from "./helpers";

const TZ = "America/Bogota";
const OPTS = { tz: TZ, gapMin: 10, slotStep: 15, minAdvanceMin: 0, maxAdvanceDays: 365 };

describe("double-booking prevention", () => {
  let fx: TestFixture;

  beforeAll(async () => {
    fx = await setupTestBarber();
  });

  afterAll(async () => {
    await teardownTestBarber();
  });

  it("lets exactly one of two simultaneous requests for the same slot succeed", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 20);
    const startMin = 9 * 60; // 09:00

    const [a, b] = await Promise.all([
      createAppointmentTx({
        barberId: fx.barber.id,
        clientName: "Cliente A",
        clientPhone: "3001110001",
        serviceId: fx.service30.id,
        serviceName: fx.service30.name,
        price: fx.service30.price,
        durationMin: 30,
        dateStr: target,
        startMin,
        createdBy: "cliente",
        status: "confirmada",
        opts: OPTS,
      }),
      createAppointmentTx({
        barberId: fx.barber.id,
        clientName: "Cliente B",
        clientPhone: "3002220002",
        serviceId: fx.service30.id,
        serviceName: fx.service30.name,
        price: fx.service30.price,
        durationMin: 30,
        dateStr: target,
        startMin,
        createdBy: "cliente",
        status: "confirmada",
        opts: OPTS,
      }),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const dayStart = new Date(`${target}T00:00:00.000Z`);
    const rows = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.barberId, fx.barber.id),
          sql`${appointments.startTime} >= ${dayStart.toISOString()}::timestamptz`,
          sql`${appointments.startTime} < (${dayStart.toISOString()}::timestamptz + interval '1 day')`,
          sql`${appointments.status} NOT IN ('cancelada','no_asistio')`,
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("rejects a booking that partially overlaps an existing one", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 21);
    const first = await createAppointmentTx({
      barberId: fx.barber.id,
      clientName: "Cliente C",
      clientPhone: "3003330003",
      serviceId: fx.service60.id,
      serviceName: fx.service60.name,
      price: fx.service60.price,
      durationMin: 60,
      dateStr: target,
      startMin: 10 * 60,
      createdBy: "cliente",
      status: "confirmada",
      opts: OPTS,
    });
    expect(first.ok).toBe(true);

    // Overlaps the tail end of the first appointment (10:30-11:00 is inside 10:00-11:00 + gap).
    const second = await createAppointmentTx({
      barberId: fx.barber.id,
      clientName: "Cliente D",
      clientPhone: "3004440004",
      serviceId: fx.service30.id,
      serviceName: fx.service30.name,
      price: fx.service30.price,
      durationMin: 30,
      dateStr: target,
      startMin: 10 * 60 + 30,
      createdBy: "cliente",
      status: "confirmada",
      opts: OPTS,
    });
    expect(second.ok).toBe(false);
  });
});
