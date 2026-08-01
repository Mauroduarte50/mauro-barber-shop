import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  blockedSlots,
  breaks,
  businessHours,
  clients,
  notifications,
  payments,
  pushSubscriptions,
  services,
  sessions,
  users,
} from "@/db/schema";

// In-memory stand-in for Next's request-scoped cookie store, same pattern
// as tests/auth.test.ts, so ensureAdmin()'s cookies() calls work here.
const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
}));

const { createSession, hashPassword, getCurrentUser } = await import("@/lib/auth");
const { factoryReset } = await import("@/lib/actions");

const TEST_EMAIL = "vitest-factory-reset@example.com";

// factoryReset wipes these tables GLOBALLY (no barberId scoping, by
// design — it resets the whole system, not one barber). That means this
// test exercises the real destructive transaction against the shared dev
// database, including the seed data. To keep that safe and repeatable, we
// snapshot every row up front and restore it all in afterAll, in FK-safe
// order (parents before children).
describe("factoryReset (danger zone)", () => {
  let snapshot: {
    services: (typeof services.$inferSelect)[];
    businessHours: (typeof businessHours.$inferSelect)[];
    breaks: (typeof breaks.$inferSelect)[];
    blockedSlots: (typeof blockedSlots.$inferSelect)[];
    clients: (typeof clients.$inferSelect)[];
    appointments: (typeof appointments.$inferSelect)[];
    payments: (typeof payments.$inferSelect)[];
    notifications: (typeof notifications.$inferSelect)[];
    pushSubscriptions: (typeof pushSubscriptions.$inferSelect)[];
  };
  let adminUserId: string;

  beforeAll(async () => {
    snapshot = {
      services: await db.select().from(services),
      businessHours: await db.select().from(businessHours),
      breaks: await db.select().from(breaks),
      blockedSlots: await db.select().from(blockedSlots),
      clients: await db.select().from(clients),
      appointments: await db.select().from(appointments),
      payments: await db.select().from(payments),
      notifications: await db.select().from(notifications),
      pushSubscriptions: await db.select().from(pushSubscriptions),
    };

    const [u] = await db
      .insert(users)
      .values({ name: "Vitest Reset Admin", email: TEST_EMAIL, passwordHash: await hashPassword("s3cret!") })
      .returning();
    adminUserId = u.id;
  });

  afterAll(async () => {
    if (snapshot.services.length) await db.insert(services).values(snapshot.services);
    if (snapshot.businessHours.length) await db.insert(businessHours).values(snapshot.businessHours);
    if (snapshot.breaks.length) await db.insert(breaks).values(snapshot.breaks);
    if (snapshot.blockedSlots.length) await db.insert(blockedSlots).values(snapshot.blockedSlots);
    if (snapshot.clients.length) await db.insert(clients).values(snapshot.clients);
    if (snapshot.appointments.length) await db.insert(appointments).values(snapshot.appointments);
    if (snapshot.payments.length) await db.insert(payments).values(snapshot.payments);
    if (snapshot.notifications.length) await db.insert(notifications).values(snapshot.notifications);
    if (snapshot.pushSubscriptions.length) await db.insert(pushSubscriptions).values(snapshot.pushSubscriptions);

    await db.delete(sessions).where(eq(sessions.userId, adminUserId));
    await db.delete(users).where(eq(users.id, adminUserId));
  });

  it("rejects when there is no authenticated session — same guard as every other admin action", async () => {
    store.clear();
    await expect(factoryReset("ELIMINAR")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("rejects when the confirmation text doesn't match exactly, and deletes nothing", async () => {
    store.clear();
    await createSession(adminUserId);
    const before = await db.select({ id: services.id }).from(services);

    expect((await factoryReset("eliminar")).ok).toBe(false); // wrong case
    expect((await factoryReset("ELIMINAR ")).ok).toBe(false); // trailing space
    expect((await factoryReset("")).ok).toBe(false); // empty

    const after = await db.select({ id: services.id }).from(services);
    expect(after.length).toBe(before.length);
  });

  it("wipes every operational table and preserves the admin account, which can still log in afterward", async () => {
    store.clear();
    await createSession(adminUserId);

    const res = await factoryReset("ELIMINAR");
    expect(res.ok).toBe(true);

    const [a, c, n, s, bh, br, bs, pay, push] = await Promise.all([
      db.select().from(appointments),
      db.select().from(clients),
      db.select().from(notifications),
      db.select().from(services),
      db.select().from(businessHours),
      db.select().from(breaks),
      db.select().from(blockedSlots),
      db.select().from(payments),
      db.select().from(pushSubscriptions),
    ]);
    expect(a).toHaveLength(0);
    expect(c).toHaveLength(0);
    expect(n).toHaveLength(0);
    expect(s).toHaveLength(0);
    expect(bh).toHaveLength(0);
    expect(br).toHaveLength(0);
    expect(bs).toHaveLength(0);
    expect(pay).toHaveLength(0);
    expect(push).toHaveLength(0);

    // The admin account itself is untouched.
    const userRows = await db.select().from(users).where(eq(users.id, adminUserId));
    expect(userRows).toHaveLength(1);
    expect(userRows[0].email).toBe(TEST_EMAIL);

    // The reset logs the admin out (current session destroyed)...
    const current = await getCurrentUser();
    expect(current).toBeNull();

    // ...but the account can still authenticate normally afterward.
    store.clear();
    await createSession(adminUserId);
    const relogged = await getCurrentUser();
    expect(relogged?.id).toBe(adminUserId);
  });
});
