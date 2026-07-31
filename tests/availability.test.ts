import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { blockedSlots, businessHours } from "@/db/schema";
import { getDayAvailability, createAppointmentTx } from "@/lib/availability";
import { addDaysStr, todayStrInTz } from "@/lib/utils";
import { setupTestBarber, teardownTestBarber, type TestFixture } from "./helpers";

const TZ = "America/Bogota";
const OPTS = { tz: TZ, gapMin: 10, slotStep: 15, minAdvanceMin: 0, maxAdvanceDays: 365 };

describe("availability engine", () => {
  let fx: TestFixture;

  beforeAll(async () => {
    fx = await setupTestBarber();
  });

  afterAll(async () => {
    await teardownTestBarber();
  });

  it("marks a past date as unavailable", async () => {
    const yesterday = addDaysStr(todayStrInTz(TZ), -1);
    const day = await getDayAvailability(fx.barber.id, yesterday, 30, OPTS);
    expect(day.working).toBe(false);
    expect(day.reason).toBe("past");
    expect(day.slots).toHaveLength(0);
  });

  it("marks a date beyond max advance days as unavailable", async () => {
    const farFuture = addDaysStr(todayStrInTz(TZ), 400);
    const day = await getDayAvailability(fx.barber.id, farFuture, 30, OPTS);
    expect(day.working).toBe(false);
    expect(day.reason).toBe("max_advance");
  });

  it("has no slots during a recurring break window", async () => {
    // find the next weekday (breaks are Mon-Fri 12:00-13:00)
    let d = addDaysStr(todayStrInTz(TZ), 10);
    const day = await getDayAvailability(fx.barber.id, d, 30, OPTS);
    const duringBreak = day.slots.find((s) => s.startMin >= 12 * 60 && s.startMin < 13 * 60);
    expect(duringBreak).toBeUndefined();
  });

  it("marks a fully blocked day as unavailable", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 11);
    await db.insert(blockedSlots).values({ barberId: fx.barber.id, date: target, startMin: 0, endMin: 24 * 60, reason: "test", allDay: true });
    const day = await getDayAvailability(fx.barber.id, target, 30, OPTS);
    expect(day.working).toBe(false);
    expect(day.reason).toBe("blocked");
    await db.delete(blockedSlots).where(and(eq(blockedSlots.barberId, fx.barber.id), eq(blockedSlots.date, target)));
  });

  it("marks a specific blocked time range as 'blocked' and unselectable", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 12);
    await db.insert(blockedSlots).values({ barberId: fx.barber.id, date: target, startMin: 14 * 60, endMin: 15 * 60, reason: "diligencia" });
    const day = await getDayAvailability(fx.barber.id, target, 30, OPTS);
    const slot = day.slots.find((s) => s.startMin === 14 * 60);
    expect(slot?.status).toBe("blocked");
    await db.delete(blockedSlots).where(and(eq(blockedSlots.barberId, fx.barber.id), eq(blockedSlots.date, target)));
  });

  it("recalculates available slots when the service duration changes", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 13);
    // Book 10:00-10:30 with the 30-min service.
    const created = await createAppointmentTx({
      barberId: fx.barber.id,
      clientName: "Duration Test",
      clientPhone: "3000000013",
      serviceId: fx.service30.id,
      serviceName: fx.service30.name,
      price: fx.service30.price,
      durationMin: 30,
      dateStr: target,
      startMin: 10 * 60,
      createdBy: "cliente",
      status: "confirmada",
      opts: OPTS,
    });
    expect(created.ok).toBe(true);

    const day30 = await getDayAvailability(fx.barber.id, target, 30, OPTS);
    const day60 = await getDayAvailability(fx.barber.id, target, 60, OPTS);

    // 09:30 + 30min ends exactly at 10:00 (gap-adjusted occupied window starts at 10:00) -> available for a 30-min service.
    const slot930in30 = day30.slots.find((s) => s.startMin === 9 * 60 + 30);
    expect(slot930in30?.status).toBe("available");

    // 09:30 + 60min would run into the booked 10:00-10:30 slot -> occupied for a 60-min service.
    const slot930in60 = day60.slots.find((s) => s.startMin === 9 * 60 + 30);
    expect(slot930in60?.status).toBe("occupied");

    // The exact booked slot is occupied regardless of duration.
    expect(day30.slots.find((s) => s.startMin === 10 * 60)?.status).toBe("occupied");
  });

  it("does not offer slots outside configured business hours", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 14);
    const day = await getDayAvailability(fx.barber.id, target, 30, OPTS);
    expect(day.slots.some((s) => s.startMin < 8 * 60)).toBe(false);
    expect(day.slots.some((s) => s.startMin + 30 > 20 * 60)).toBe(false);
  });

  it("closes a day entirely with no business-hours rows", async () => {
    const target = addDaysStr(todayStrInTz(TZ), 15);
    const weekday = ((new Date(target + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
    // Temporarily wipe hours for that weekday.
    const existing = await db.select().from(businessHours).where(and(eq(businessHours.barberId, fx.barber.id), eq(businessHours.weekday, weekday)));
    await db.delete(businessHours).where(and(eq(businessHours.barberId, fx.barber.id), eq(businessHours.weekday, weekday)));

    const day = await getDayAvailability(fx.barber.id, target, 30, OPTS);
    expect(day.working).toBe(false);
    expect(day.reason).toBe("closed");

    await db.insert(businessHours).values(existing);
  });
});
