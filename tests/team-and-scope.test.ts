import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appointments, barbers, clients, sessions, users } from "@/db/schema";
import { addDaysStr, slotToDate, todayStrInTz } from "@/lib/utils";
import { setupTestBarber, teardownTestBarber, type TestFixture } from "./helpers";

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

const { createSession, getCurrentUser, hashPassword, verifyPassword } = await import("@/lib/auth");
const actions = await import("@/lib/actions");

const TZ = "America/Bogota";
const EMAIL_ADMIN = "vitest-team-admin@example.com";
const EMAIL_BARBERO_A = "vitest-team-barbero-a@example.com";
const NEW_BARBER_EMAIL = "vitest-team-new-barbero@example.com";

async function loginAs(userId: string) {
  store.clear();
  await createSession(userId);
}

async function makeAppointmentFor(fx: TestFixture, phone: string, offsetDays: number) {
  const [client] = await db.insert(clients).values({ barberId: fx.barber.id, name: "Cliente", phone }).returning();
  const date = addDaysStr(todayStrInTz(TZ), offsetDays);
  const start = slotToDate(date, 9 * 60, TZ);
  const end = slotToDate(date, 9 * 60 + fx.service30.durationMin, TZ);
  const [appt] = await db
    .insert(appointments)
    .values({
      code: `SCOPE-${phone}`,
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

async function wipeTestUsers() {
  const emails = [EMAIL_ADMIN, EMAIL_BARBERO_A, NEW_BARBER_EMAIL];
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.email, emails));
  for (const r of rows) await db.delete(sessions).where(eq(sessions.userId, r.id));
  await db.delete(users).where(inArray(users.email, emails));
}

/** createBarberAccount() makes a real `barbers` row too — not just a user — so it needs its own cleanup. */
async function wipeCreatedBarber() {
  await db.delete(barbers).where(ilike(barbers.slug, "nuevo-barbero%"));
}

describe("team management (admin-only)", () => {
  let a: TestFixture;
  let admin: { id: string; name: string };
  let barberoA: { id: string; name: string };

  beforeEach(async () => {
    await wipeTestUsers();
    await wipeCreatedBarber();
    a = await setupTestBarber("a");
    [admin] = await db
      .insert(users)
      .values({ name: "Admin", email: EMAIL_ADMIN, passwordHash: await hashPassword("s3cret!"), role: "admin" })
      .returning({ id: users.id, name: users.name });
    [barberoA] = await db
      .insert(users)
      .values({ name: "Barbero A", email: EMAIL_BARBERO_A, passwordHash: await hashPassword("s3cret!"), role: "barbero", barberId: a.barber.id })
      .returning({ id: users.id, name: users.name });
  });

  afterAll(async () => {
    await wipeTestUsers();
    await wipeCreatedBarber();
    await teardownTestBarber("a");
  });

  it("lets an admin create a new barber with a working login account", async () => {
    await loginAs(admin.id);
    const res = await actions.createBarberAccount({ name: "Nuevo Barbero", phone: "3001234567", email: NEW_BARBER_EMAIL, password: "clave123" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [newUser] = await db.select().from(users).where(eq(users.email, NEW_BARBER_EMAIL));
    expect(newUser.role).toBe("barbero");
    expect(newUser.barberId).toBe(res.barberId);
    expect(await verifyPassword("clave123", newUser.passwordHash)).toBe(true);

    const barbersList = await actions.listBarbers();
    expect(barbersList.some((b) => b.id === res.barberId && b.email === NEW_BARBER_EMAIL)).toBe(true);
  });

  it("rejects a duplicate email when creating a barber", async () => {
    await loginAs(admin.id);
    const res = await actions.createBarberAccount({ name: "Otro", email: EMAIL_BARBERO_A, password: "clave123" });
    expect(res.ok).toBe(false);
  });

  it("blocks a barbero from team-management actions (redirected, not just denied)", async () => {
    await loginAs(barberoA.id);
    await expect(actions.listBarbers()).rejects.toThrow("REDIRECT:/admin");
    await expect(
      actions.createBarberAccount({ name: "X", email: "x@example.com", password: "clave123" }),
    ).rejects.toThrow("REDIRECT:/admin");
  });

  it("updates a barber's profile (name/phone) and keeps their login name in sync", async () => {
    await loginAs(admin.id);
    await actions.updateBarberProfile({ barberId: a.barber.id, name: "Barbero Renombrado", phone: "3009998888" });
    const [updatedUser] = await db.select().from(users).where(eq(users.id, barberoA.id));
    expect(updatedUser.name).toBe("Barbero Renombrado");
  });

  it("resets a barber's password", async () => {
    await loginAs(admin.id);
    const res = await actions.resetBarberPassword(a.barber.id, "nuevaClave123");
    expect(res.ok).toBe(true);
    const [updatedUser] = await db.select().from(users).where(eq(users.id, barberoA.id));
    expect(await verifyPassword("nuevaClave123", updatedUser.passwordHash)).toBe(true);
  });

  it("deactivating a barber blocks their login immediately, even with an existing session", async () => {
    await loginAs(barberoA.id);
    expect(await getCurrentUser()).not.toBeNull();

    await loginAs(admin.id);
    await actions.setBarberActive(a.barber.id, false);

    // A still-valid session token for the now-deactivated barbero must stop
    // resolving to a user — checked live on every call, not just at login.
    await loginAs(barberoA.id);
    expect(await getCurrentUser()).toBeNull();
  });

  it("reactivating a barber restores their login", async () => {
    await loginAs(admin.id);
    await actions.setBarberActive(a.barber.id, false);
    await actions.setBarberActive(a.barber.id, true);
    await loginAs(barberoA.id);
    expect(await getCurrentUser()).not.toBeNull();
  });
});

describe("admin barber-scope selector", () => {
  let a: TestFixture;
  let b: TestFixture;
  let admin: { id: string; name: string };
  let barberoA: { id: string; name: string };

  beforeEach(async () => {
    await wipeTestUsers();
    a = await setupTestBarber("a");
    b = await setupTestBarber("b");
    [admin] = await db
      .insert(users)
      .values({ name: "Admin", email: EMAIL_ADMIN, passwordHash: await hashPassword("s3cret!"), role: "admin" })
      .returning({ id: users.id, name: users.name });
    [barberoA] = await db
      .insert(users)
      .values({ name: "Barbero A", email: EMAIL_BARBERO_A, passwordHash: await hashPassword("s3cret!"), role: "barbero", barberId: a.barber.id })
      .returning({ id: users.id, name: users.name });
  });

  afterAll(async () => {
    await wipeTestUsers();
    await teardownTestBarber("a");
    await teardownTestBarber("b");
  });

  it("admin scoped to a specific barber sees only that barber's appointments", async () => {
    const { appt: apptA } = await makeAppointmentFor(a, "3008880001", 20);
    const { appt: apptB } = await makeAppointmentFor(b, "3008880002", 20);
    await loginAs(admin.id);

    const rowsA = await actions.listAppointments({}, a.barber.id);
    expect(rowsA.some((r) => r.code === apptA.code)).toBe(true);
    expect(rowsA.some((r) => r.code === apptB.code)).toBe(false);
  });

  it('admin scoped to "all" sees appointments from every active barber, tagged with barberName', async () => {
    const { appt: apptA } = await makeAppointmentFor(a, "3008880003", 21);
    const { appt: apptB } = await makeAppointmentFor(b, "3008880004", 21);
    await loginAs(admin.id);

    const rows = await actions.listAppointments({}, "all");
    expect(rows.some((r) => r.code === apptA.code && r.barberName === a.barber.name)).toBe(true);
    expect(rows.some((r) => r.code === apptB.code && r.barberName === b.barber.name)).toBe(true);
  });

  it("a barbero's own requestedBarberId/scope argument is always ignored, even if it names another barber or \"all\"", async () => {
    const { appt: apptA } = await makeAppointmentFor(a, "3008880005", 22);
    const { appt: apptB } = await makeAppointmentFor(b, "3008880006", 22);
    await loginAs(barberoA.id);

    const rowsTryingAll = await actions.listAppointments({}, "all");
    expect(rowsTryingAll.some((r) => r.code === apptA.code)).toBe(true);
    expect(rowsTryingAll.some((r) => r.code === apptB.code)).toBe(false);

    const rowsTryingB = await actions.listAppointments({}, b.barber.id);
    expect(rowsTryingB.some((r) => r.code === apptA.code)).toBe(true);
    expect(rowsTryingB.some((r) => r.code === apptB.code)).toBe(false);
  });

  it("an admin can manage (change status of) any barber's appointment regardless of current scope selection", async () => {
    const { appt } = await makeAppointmentFor(b, "3008880007", 23);
    await loginAs(admin.id);

    const result = await actions.setAppointmentStatus(appt.id, "atendida");
    expect(result).toEqual({ ok: true });
    const [row] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    expect(row.status).toBe("atendida");
  });

  it('listClients filters correctly for a specific barber and includes barberName in "all" scope', async () => {
    const { client: clientA } = await makeAppointmentFor(a, "3008880008", 24);
    const { client: clientB } = await makeAppointmentFor(b, "3008880009", 24);
    await loginAs(admin.id);

    const onlyA = await actions.listClients(undefined, a.barber.id);
    expect(onlyA.some((c) => c.id === clientA.id)).toBe(true);
    expect(onlyA.some((c) => c.id === clientB.id)).toBe(false);

    const all = await actions.listClients(undefined, "all");
    expect(all.some((c) => c.id === clientA.id && c.barberName === a.barber.name)).toBe(true);
    expect(all.some((c) => c.id === clientB.id && c.barberName === b.barber.name)).toBe(true);
  });
});
