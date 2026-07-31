import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

// In-memory stand-in for Next's request-scoped cookie store, so auth.ts's
// `cookies()` calls work outside of an actual HTTP request/response cycle.
const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  }),
}));

const { createSession, destroySession, getCurrentUser, hashPassword, verifyPassword } = await import("@/lib/auth");

const TEST_EMAIL = "vitest-auth@example.com";

async function makeUser() {
  const [u] = await db
    .insert(users)
    .values({ name: "Vitest User", email: TEST_EMAIL, passwordHash: await hashPassword("s3cret!") })
    .returning();
  return u;
}

describe("auth", () => {
  beforeEach(() => {
    store.clear();
  });

  afterAll(async () => {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL));
    for (const r of rows) await db.delete(sessions).where(eq(sessions.userId, r.id));
    await db.delete(users).where(eq(users.email, TEST_EMAIL));
  });

  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("returns null when there is no session cookie (unauthenticated access)", async () => {
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  it("returns the user for a freshly created session, then null after logout", async () => {
    const u = await makeUser();
    await createSession(u.id);
    const current = await getCurrentUser();
    expect(current?.id).toBe(u.id);

    await destroySession();
    const afterLogout = await getCurrentUser();
    expect(afterLogout).toBeNull();
  });

  it("returns null for an expired session token", async () => {
    const u = await db.select().from(users).where(eq(users.email, TEST_EMAIL)).then((r) => r[0]);
    const [expired] = await db
      .insert(sessions)
      .values({ userId: u.id, token: "expired-token-vitest", expiresAt: new Date(Date.now() - 1000) })
      .returning();
    store.set("barber_session", expired.token);
    const current = await getCurrentUser();
    expect(current).toBeNull();
  });
});
