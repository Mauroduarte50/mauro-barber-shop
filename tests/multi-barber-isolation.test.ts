import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appointments, clients, pushSubscriptions, sessions, users } from "@/db/schema";
import { addDaysStr, slotToDate, todayStrInTz } from "@/lib/utils";
import { setupTestBarber, teardownTestBarber, type TestFixture } from "./helpers";

// Same in-memory cookie-store mock as auth.test.ts, so createSession()/
// getCurrentUser() work outside a real request. next/cache and
// next/navigation are mocked too since actions.ts calls revalidatePath() on
// every mutation and redirect() when a guard rejects — neither exists
// outside Next's request lifecycle, so we stub them: revalidatePath is a
// no-op, redirect throws (mirroring how it never returns in production).
const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { createSession, hashPassword } = await import("@/lib/auth");
const actions = await import("@/lib/actions");

const TZ = "America/Bogota";
const EMAIL_BARBERO_A = "vitest-barbero-a@example.com";
const EMAIL_ADMIN_A = "vitest-admin-a@example.com";

async function loginAs(userId: string) {
  store.clear();
  await createSession(userId);
}

async function makeAppointmentFor(fx: TestFixture, phone: string) {
  const [client] = await db.insert(clients).values({ barberId: fx.barber.id, name: "Cliente", phone }).returning();
  const date = addDaysStr(todayStrInTz(TZ), 10);
  const start = slotToDate(date, 9 * 60, TZ);
  const end = slotToDate(date, 9 * 60 + fx.service30.durationMin, TZ);
  const [appt] = await db
    .insert(appointments)
    .values({
      code: `ISO-${phone}`,
      barberId: fx.barber.id,
      clientId: client.id,
      serviceId: fx.service30.id,
      serviceName: fx.service30.name,
      price: fx.service30.price,
      durationMin: fx.service30.durationMin,
      startTime: start,
      endTime: end,
      status: "confirmada",
      createdBy: "cliente",
    })
    .returning();
  return { client, appt };
}

describe("multi-barber data isolation", () => {
  let a: TestFixture;
  let b: TestFixture;
  let barberoA: { id: string; name: string };
  let adminA: { id: string; name: string };

  beforeEach(async () => {
    const stale = await db.select({ id: users.id }).from(users).where(inArray(users.email, [EMAIL_BARBERO_A, EMAIL_ADMIN_A]));
    for (const u of stale) await db.delete(sessions).where(eq(sessions.userId, u.id));
    await db.delete(users).where(inArray(users.email, [EMAIL_BARBERO_A, EMAIL_ADMIN_A]));

    a = await setupTestBarber("a");
    b = await setupTestBarber("b");
    [barberoA] = await db
      .insert(users)
      .values({
        name: "Barbero A",
        email: EMAIL_BARBERO_A,
        passwordHash: await hashPassword("s3cret!"),
        role: "barbero",
        barberId: a.barber.id,
      })
      .returning({ id: users.id, name: users.name });
    // A pure manager admin (no barberId of their own — one barber can only
    // ever have one login account, enforced by users_barber_idx) — the
    // "cousin who owns the shop but doesn't cut hair" case from the spec.
    [adminA] = await db
      .insert(users)
      .values({
        name: "Admin",
        email: EMAIL_ADMIN_A,
        passwordHash: await hashPassword("s3cret!"),
        role: "admin",
      })
      .returning({ id: users.id, name: users.name });
  });

  afterAll(async () => {
    await db.delete(sessions).where(eq(sessions.userId, barberoA?.id ?? ""));
    await db.delete(users).where(eq(users.email, EMAIL_BARBERO_A));
    await db.delete(users).where(eq(users.email, EMAIL_ADMIN_A));
    await teardownTestBarber("a");
    await teardownTestBarber("b");
  });

  it("barbero A cannot change the status of barbero B's appointment by id", async () => {
    const { appt } = await makeAppointmentFor(b, "3009990001");
    await loginAs(barberoA.id);

    const result = await actions.setAppointmentStatus(appt.id, "atendida");
    expect(result).toEqual({ ok: false, error: "Cita no encontrada." });

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.status).toBe("confirmada");
  });

  it("barbero A cannot cancel barbero B's appointment by id", async () => {
    const { appt } = await makeAppointmentFor(b, "3009990002");
    await loginAs(barberoA.id);

    const result = await actions.cancelAppointment(appt.id);
    expect(result).toEqual({ ok: false, error: "No encontrada." });

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.status).toBe("confirmada");
  });

  it("barbero A cannot record a payment on barbero B's appointment by id", async () => {
    const { appt } = await makeAppointmentFor(b, "3009990003");
    await loginAs(barberoA.id);

    const result = await actions.recordPayment(appt.id, "efectivo");
    expect(result).toEqual({ ok: false, error: "Cita no encontrada." });

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.paid).toBe(false);
  });

  it("barbero A cannot set the payment method on barbero B's appointment by id", async () => {
    const { appt } = await makeAppointmentFor(b, "3009990004");
    await loginAs(barberoA.id);

    const result = await actions.setPaymentMethod(appt.id, "nequi");
    expect(result).toEqual({ ok: false, error: "Cita no encontrada." });

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.paymentMethod).toBeNull();
  });

  it("barbero A cannot edit barbero B's client by id", async () => {
    const { client } = await makeAppointmentFor(b, "3009990005");
    await loginAs(barberoA.id);

    const result = await actions.updateClient({ id: client.id, name: "Hackeado", phone: "0000000000" });
    expect(result).toEqual({ ok: false, error: "Cliente no encontrado." });

    const [row] = await db.select().from(clients).where(eq(clients.id, client.id));
    expect(row.name).toBe("Cliente");
  });

  it("barbero A cannot delete or read barbero B's push subscription by endpoint", async () => {
    const endpoint = "https://push.example.com/isolation-test";
    await db.insert(pushSubscriptions).values({ barberId: b.barber.id, endpoint, p256dh: "p", auth: "a" });
    await loginAs(barberoA.id);

    const status = await actions.getPushSubscriptionStatus(endpoint);
    expect(status).toEqual({ subscribed: false });

    await actions.deletePushSubscription(endpoint);
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(rows).toHaveLength(1);
  });

  it("creating an appointment with another barber's serviceId falls back to a manual entry, never barber B's price", async () => {
    await loginAs(barberoA.id);
    const date = addDaysStr(todayStrInTz(TZ), 11);

    const result = await actions.createAppointment({
      clientName: "Cliente Manual",
      clientPhone: "3009990006",
      serviceId: b.service60.id,
      date,
      time: "09:00",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(appointments).where(eq(appointments.code, result.code));
    expect(row.serviceName).toBe("Cita manual");
    expect(row.price).toBe(0);
    expect(row.barberId).toBe(a.barber.id);
  });

  it("as a sanity check, barbero A CAN manage their own barber's appointment normally", async () => {
    const { appt } = await makeAppointmentFor(a, "3009990007");
    await loginAs(barberoA.id);

    const result = await actions.setAppointmentStatus(appt.id, "atendida");
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.status).toBe("atendida");
  });

  it("only real admins can read the audit log; a barbero is redirected away", async () => {
    await loginAs(adminA.id);
    await expect(actions.getAuditLogs()).resolves.toBeInstanceOf(Array);

    await loginAs(barberoA.id);
    await expect(actions.getAuditLogs()).rejects.toThrow("REDIRECT:/admin");
  });
});
