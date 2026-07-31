import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients } from "@/db/schema";
import { POST as createBooking } from "@/app/api/public/bookings/route";
import { GET as getBooking, PATCH as rescheduleBooking, DELETE as cancelBooking } from "@/app/api/public/bookings/[code]/route";
import { createAppointmentTx, getDayAvailability } from "@/lib/availability";
import { addDaysStr, slotToDate, todayStrInTz } from "@/lib/utils";
import { setupTestBarber, teardownTestBarber, TEST_SLUG, type TestFixture } from "./helpers";

const TZ = "America/Bogota";
const OPTS = { tz: TZ, gapMin: 10, slotStep: 15, minAdvanceMin: 0, maxAdvanceDays: 365 };

function jsonRequest(body: unknown, method = "POST") {
  return new Request("http://localhost/api/public/bookings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public booking API", () => {
  let fx: TestFixture;

  beforeAll(async () => {
    fx = await setupTestBarber();
  });

  afterAll(async () => {
    await teardownTestBarber();
  });

  it("creates a booking with a valid BAR-YYYYMMDD-#### code", async () => {
    const date = addDaysStr(todayStrInTz(TZ), 30);
    const res = await createBooking(
      jsonRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 9 * 60, name: "Ana Test", phone: "3005550001" }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.booking.code).toMatch(/^BAR-\d{8}-\d{4}$/);
    expect(data.booking.status).toBe("confirmada");
  });

  it("rejects a booking in the past with 400", async () => {
    const yesterday = addDaysStr(todayStrInTz(TZ), -1);
    const res = await createBooking(
      jsonRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date: yesterday, startMin: 9 * 60, name: "Ana Test", phone: "3005550002" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a booking with an invalid phone number", async () => {
    const date = addDaysStr(todayStrInTz(TZ), 31);
    const res = await createBooking(
      jsonRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 9 * 60, name: "Ana Test", phone: "abc" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a booking for an already-occupied slot with 409", async () => {
    const date = addDaysStr(todayStrInTz(TZ), 32);
    const first = await createBooking(
      jsonRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 10 * 60, name: "First", phone: "3005550003" }),
    );
    expect(first.status).toBe(200);

    const second = await createBooking(
      jsonRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 10 * 60, name: "Second", phone: "3005550004" }),
    );
    expect(second.status).toBe(409);
  });

  it("cancellation frees the slot and enforces the minimum-notice window", async () => {
    const date = addDaysStr(todayStrInTz(TZ), 33);
    const created = await createBooking(
      jsonRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 11 * 60, name: "Cancelable", phone: "3005550005" }),
    );
    const { booking } = await created.json();

    const res = await cancelBooking(new Request(`http://localhost/api/public/bookings/${booking.code}`, { method: "DELETE" }), {
      params: Promise.resolve({ code: booking.code }),
    });
    expect(res.status).toBe(200);

    const day = await getDayAvailability(fx.barber.id, date, 30, OPTS);
    expect(day.slots.find((s) => s.startMin === 11 * 60)?.status).toBe("available");

    // A booking starting in 30 minutes should NOT be cancellable under a 120-min policy.
    const [client] = await db.insert(clients).values({ barberId: fx.barber.id, name: "Soon", phone: "3005550006" }).returning();
    const soonStart = new Date(Date.now() + 30 * 60 * 1000);
    const [soonAppt] = await db
      .insert(appointments)
      .values({
        code: "BAR-TESTSOON-0001",
        barberId: fx.barber.id,
        clientId: client.id,
        serviceId: fx.service30.id,
        serviceName: fx.service30.name,
        price: fx.service30.price,
        durationMin: 30,
        startTime: soonStart,
        endTime: new Date(soonStart.getTime() + 30 * 60 * 1000),
        status: "confirmada",
        createdBy: "cliente",
      })
      .returning();

    const res2 = await cancelBooking(new Request(`http://localhost/api/public/bookings/${soonAppt.code}`, { method: "DELETE" }), {
      params: Promise.resolve({ code: soonAppt.code }),
    });
    expect(res2.status).toBe(400);
    const rows = await db.select().from(appointments).where(eq(appointments.id, soonAppt.id));
    expect(rows[0].status).toBe("confirmada"); // unchanged
  });

  it("reschedules atomically: frees the old slot and occupies the new one", async () => {
    const date = addDaysStr(todayStrInTz(TZ), 34);
    const created = await createAppointmentTx({
      barberId: fx.barber.id,
      clientName: "Reschedule Me",
      clientPhone: "3005550007",
      serviceId: fx.service30.id,
      serviceName: fx.service30.name,
      price: fx.service30.price,
      durationMin: 30,
      dateStr: date,
      startMin: 9 * 60,
      createdBy: "cliente",
      status: "confirmada",
      opts: OPTS,
    });
    if (!created.ok) throw new Error("setup failed");
    const code = created.appointment.code;

    const res = await rescheduleBooking(
      new Request(`http://localhost/api/public/bookings/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, startMin: 15 * 60 }),
      }),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(200);

    const day = await getDayAvailability(fx.barber.id, date, 30, OPTS);
    expect(day.slots.find((s) => s.startMin === 9 * 60)?.status).toBe("available");
    expect(day.slots.find((s) => s.startMin === 15 * 60)?.status).toBe("occupied");

    const check = await getBooking(new Request(`http://localhost/api/public/bookings/${code}`), { params: Promise.resolve({ code }) });
    const data = await check.json();
    expect(new Date(data.booking.startTime).getTime()).toBe(slotToDate(date, 15 * 60, TZ).getTime());
  });
});
