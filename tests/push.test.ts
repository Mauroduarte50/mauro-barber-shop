import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, pushSubscriptions } from "@/db/schema";
import { setupTestBarber, teardownTestBarber, TEST_SLUG, type TestFixture } from "./helpers";
import { addDaysStr, todayStrInTz } from "@/lib/utils";

const sendNotificationMock = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}));

const { sendPushToBarber } = await import("@/lib/push");
const { notify } = await import("@/lib/system");
const { POST: createBooking } = await import("@/app/api/public/bookings/route");
const { PATCH: rescheduleBooking, DELETE: cancelBooking } = await import("@/app/api/public/bookings/[code]/route");

const TZ = "America/Bogota";

describe("web push", () => {
  let fx: TestFixture;

  beforeAll(async () => {
    fx = await setupTestBarber();
  });

  afterAll(async () => {
    await teardownTestBarber();
  });

  afterEach(async () => {
    sendNotificationMock.mockReset();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.barberId, fx.barber.id));
  });

  it("sends a push to every subscription registered for the barber, with title/body/url in the payload", async () => {
    await db.insert(pushSubscriptions).values([
      { barberId: fx.barber.id, endpoint: "https://push.example.com/a", p256dh: "p1", auth: "a1" },
      { barberId: fx.barber.id, endpoint: "https://push.example.com/b", p256dh: "p2", auth: "a2" },
    ]);
    sendNotificationMock.mockResolvedValue({});

    await sendPushToBarber(fx.barber.id, { title: "🔔 Nueva reserva", body: "Juan Pérez — Corte + Barba", url: "/admin" });

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const [sub, payload] = sendNotificationMock.mock.calls[0];
    expect(sub.endpoint).toMatch(/^https:\/\/push\.example\.com/);
    expect(JSON.parse(payload)).toMatchObject({ title: "🔔 Nueva reserva", body: "Juan Pérez — Corte + Barba", url: "/admin" });
  });

  it("does nothing (no error, no calls) when the barber has no subscriptions", async () => {
    await expect(sendPushToBarber(fx.barber.id, { title: "x", body: "y" })).resolves.toBeUndefined();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("removes the subscription when the push service reports it's gone (410)", async () => {
    const [sub] = await db
      .insert(pushSubscriptions)
      .values({ barberId: fx.barber.id, endpoint: "https://push.example.com/dead", p256dh: "p", auth: "a" })
      .returning();
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 });

    await sendPushToBarber(fx.barber.id, { title: "x", body: "y" });

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    expect(rows).toHaveLength(0);
  });

  it("never throws even if the push service fails unexpectedly (must not break the booking flow)", async () => {
    await db.insert(pushSubscriptions).values({ barberId: fx.barber.id, endpoint: "https://push.example.com/flaky", p256dh: "p", auth: "a" });
    sendNotificationMock.mockRejectedValueOnce(new Error("network down"));
    await expect(sendPushToBarber(fx.barber.id, { title: "x", body: "y" })).resolves.toBeUndefined();
  });

  it("notify() writes the internal notification AND triggers a push in one call", async () => {
    await db.insert(pushSubscriptions).values({ barberId: fx.barber.id, endpoint: "https://push.example.com/notify", p256dh: "p", auth: "a" });
    sendNotificationMock.mockResolvedValue({});

    await notify(fx.barber.id, "new_booking", "🔔 Nueva reserva", "Juan Pérez — Corte + Barba", { url: "/admin" });

    const rows = await db.select().from(notifications).where(eq(notifications.barberId, fx.barber.id));
    expect(rows.some((r) => r.title === "🔔 Nueva reserva" && r.body === "Juan Pérez — Corte + Barba")).toBe(true);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  describe("end-to-end via the real booking API routes", () => {
    function bookingRequest(body: unknown, method = "POST") {
      return new Request("http://localhost/api/public/bookings", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("push fires when a client creates a booking", async () => {
      await db.insert(pushSubscriptions).values({ barberId: fx.barber.id, endpoint: "https://push.example.com/e2e-create", p256dh: "p", auth: "a" });
      sendNotificationMock.mockResolvedValue({});

      const date = addDaysStr(todayStrInTz(TZ), 40);
      const res = await createBooking(
        bookingRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 9 * 60, name: "Push Test", phone: "3005559001" }),
      );
      expect(res.status).toBe(200);
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
      const [, payload] = sendNotificationMock.mock.calls[0];
      expect(JSON.parse(payload).title).toMatch(/reserva/i);
    });

    it("push fires when a client cancels a booking", async () => {
      const date = addDaysStr(todayStrInTz(TZ), 41);
      const created = await createBooking(
        bookingRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 9 * 60, name: "Cancel Push", phone: "3005559002" }),
      );
      const { booking } = await created.json();

      await db.insert(pushSubscriptions).values({ barberId: fx.barber.id, endpoint: "https://push.example.com/e2e-cancel", p256dh: "p", auth: "a" });
      sendNotificationMock.mockClear();
      sendNotificationMock.mockResolvedValue({});

      const res = await cancelBooking(new Request(`http://localhost/api/public/bookings/${booking.code}`, { method: "DELETE" }), {
        params: Promise.resolve({ code: booking.code }),
      });
      expect(res.status).toBe(200);
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("push fires when a client reschedules a booking", async () => {
      const date = addDaysStr(todayStrInTz(TZ), 42);
      const created = await createBooking(
        bookingRequest({ barber: TEST_SLUG, serviceId: fx.service30.id, date, startMin: 9 * 60, name: "Reschedule Push", phone: "3005559003" }),
      );
      const { booking } = await created.json();

      await db.insert(pushSubscriptions).values({ barberId: fx.barber.id, endpoint: "https://push.example.com/e2e-reschedule", p256dh: "p", auth: "a" });
      sendNotificationMock.mockClear();
      sendNotificationMock.mockResolvedValue({});

      const res = await rescheduleBooking(
        new Request(`http://localhost/api/public/bookings/${booking.code}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, startMin: 10 * 60 }),
        }),
        { params: Promise.resolve({ code: booking.code }) },
      );
      expect(res.status).toBe(200);
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    });
  });
});
