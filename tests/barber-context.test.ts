import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { getDefaultBarber, resolveOwnBarber } from "@/lib/settings";
import { setupTestBarber, teardownTestBarber } from "./helpers";

const LINKED_EMAIL = "vitest-barbero@example.com";
const UNLINKED_EMAIL = "vitest-admin-no-barber@example.com";

describe("resolveOwnBarber", () => {
  afterAll(async () => {
    await db.delete(users).where(eq(users.email, LINKED_EMAIL));
    await db.delete(users).where(eq(users.email, UNLINKED_EMAIL));
    await teardownTestBarber();
  });

  it("resolves to the user's own linked barber, ignoring which barber is 'default'", async () => {
    const { barber } = await setupTestBarber();
    const [user] = await db
      .insert(users)
      .values({
        name: "Barbero de prueba",
        email: LINKED_EMAIL,
        passwordHash: await hashPassword("s3cret!"),
        role: "barbero",
        barberId: barber.id,
      })
      .returning();

    const resolved = await resolveOwnBarber(user);
    expect(resolved?.id).toBe(barber.id);
  });

  it("falls back to the default barber when the user has none linked (today's admin-with-no-selector case)", async () => {
    const [user] = await db
      .insert(users)
      .values({
        name: "Admin sin barbero",
        email: UNLINKED_EMAIL,
        passwordHash: await hashPassword("s3cret!"),
        role: "admin",
      })
      .returning();
    expect(user.barberId).toBeNull();

    const [resolved, expected] = await Promise.all([resolveOwnBarber(user), getDefaultBarber()]);
    expect(resolved?.id).toBe(expected?.id);
  });
});
