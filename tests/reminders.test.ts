import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients, pushSubscriptions, settings as settingsTable } from "@/db/schema";
import { setupTestBarber, teardownTestBarber, type TestFixture } from "./helpers";

const sendNotificationMock = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}));

const { sendDueReminders } = await import("@/lib/reminders");
const { PATCH: rescheduleBooking } = await import("@/app/api/public/bookings/[code]/route");

async function makeClient(fx: TestFixture, phone: string, name = "Cliente Test") {
  const [c] = await db.insert(clients).values({ barberId: fx.barber.id, name, phone }).returning();
  return c;
}

async function makeAppointment(
  fx: TestFixture,
  opts: { clientId: string; code: string; startTime: Date; status?: string },
) {
  const [a] = await db
    .insert(appointments)
    .values({
      barberId: fx.barber.id,
      clientId: opts.clientId,
      code: opts.code,
      serviceName: fx.service30.name,
      price: fx.service30.price,
      durationMin: fx.service30.durationMin,
      startTime: opts.startTime,
      endTime: new Date(opts.startTime.getTime() + fx.service30.durationMin * 60_000),
      status: opts.status ?? "confirmada",
    })
    .returning();
  return a;
}

// Regression guard for the 30-min-before reminder: the reminder cron scans a
// 25-35min window (not an exact instant, since the external scheduler that
// calls it runs every ~5min and isn't perfectly on time), must never
// double-send for the same appointment even if the job overlaps itself, must
// skip cancelled appointments, and a reschedule must clear the old
// reminder_sent_at so the new time gets its own reminder.
describe("30-minute appointment reminders", () => {
  let fx: TestFixture;

  beforeAll(async () => {
    fx = await setupTestBarber();
  });

  afterAll(async () => {
    await teardownTestBarber();
  });

  afterEach(async () => {
    sendNotificationMock.mockReset();
    await db.delete(appointments).where(eq(appointments.barberId, fx.barber.id));
    await db.delete(clients).where(eq(clients.barberId, fx.barber.id));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.barberId, fx.barber.id));
    await db
      .delete(settingsTable)
      .where(and(eq(settingsTable.barberId, fx.barber.id), eq(settingsTable.key, "reminders_enabled")));
  });

  it("sends a reminder for a confirmed appointment 30 minutes out and marks it sent", async () => {
    await db
      .insert(pushSubscriptions)
      .values({ barberId: fx.barber.id, endpoint: "https://push.example.com/rem1", p256dh: "p", auth: "a" });
    sendNotificationMock.mockResolvedValue({});
    const client = await makeClient(fx, "3001110001", "Ana Torres");
    const now = new Date();
    const appt = await makeAppointment(fx, {
      clientId: client.id,
      code: "REM-0001",
      startTime: new Date(now.getTime() + 30 * 60_000),
    });

    const result = await sendDueReminders(now);

    expect(result.sent).toBe(1);
    expect(result.appointmentIds).toEqual([appt.id]);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [, payload] = sendNotificationMock.mock.calls[0];
    const parsed = JSON.parse(payload);
    expect(parsed.body).toContain("Ana Torres");
    expect(parsed.url).toBe("/admin/appointments?q=REM-0001");

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.reminderSentAt).not.toBeNull();
  });

  it("does not send outside the 25-35 minute window", async () => {
    const client = await makeClient(fx, "3001110002");
    const now = new Date();
    await makeAppointment(fx, { clientId: client.id, code: "REM-0002", startTime: new Date(now.getTime() + 60 * 60_000) });
    await makeAppointment(fx, { clientId: client.id, code: "REM-0003", startTime: new Date(now.getTime() + 5 * 60_000) });

    const result = await sendDueReminders(now);
    expect(result.sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("does not send twice for the same appointment across repeated runs", async () => {
    await db
      .insert(pushSubscriptions)
      .values({ barberId: fx.barber.id, endpoint: "https://push.example.com/rem2", p256dh: "p", auth: "a" });
    sendNotificationMock.mockResolvedValue({});
    const client = await makeClient(fx, "3001110003");
    const now = new Date();
    await makeAppointment(fx, { clientId: client.id, code: "REM-0004", startTime: new Date(now.getTime() + 30 * 60_000) });

    const first = await sendDueReminders(now);
    expect(first.sent).toBe(1);
    sendNotificationMock.mockClear();

    const second = await sendDueReminders(now);
    expect(second.sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("skips a cancelled appointment even if it falls inside the window", async () => {
    const client = await makeClient(fx, "3001110004");
    const now = new Date();
    await makeAppointment(fx, {
      clientId: client.id,
      code: "REM-0005",
      startTime: new Date(now.getTime() + 30 * 60_000),
      status: "cancelada",
    });

    const result = await sendDueReminders(now);
    expect(result.sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("respects the reminders_enabled setting", async () => {
    await db
      .insert(pushSubscriptions)
      .values({ barberId: fx.barber.id, endpoint: "https://push.example.com/rem3", p256dh: "p", auth: "a" });
    await db.insert(settingsTable).values({ barberId: fx.barber.id, key: "reminders_enabled", value: "false" });
    const client = await makeClient(fx, "3001110005");
    const now = new Date();
    await makeAppointment(fx, { clientId: client.id, code: "REM-0006", startTime: new Date(now.getTime() + 30 * 60_000) });

    const result = await sendDueReminders(now);
    expect(result.sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("rescheduling clears reminder_sent_at so the new time gets its own reminder", async () => {
    const client = await makeClient(fx, "3001110006");
    const now = new Date();
    const appt = await makeAppointment(fx, {
      clientId: client.id,
      code: "REM-0007",
      startTime: new Date(now.getTime() + 3 * 24 * 3600_000),
    });
    await db.update(appointments).set({ reminderSentAt: now }).where(eq(appointments.id, appt.id));

    const newDate = new Date(now.getTime() + 4 * 24 * 3600_000).toISOString().slice(0, 10);
    const res = await rescheduleBooking(
      new Request(`http://localhost/api/public/bookings/${appt.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, startMin: 11 * 60 }),
      }),
      { params: Promise.resolve({ code: appt.code }) },
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.reminderSentAt).toBeNull();
  });
});
