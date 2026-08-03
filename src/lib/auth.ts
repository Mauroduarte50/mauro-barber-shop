import { cookies } from "next/headers";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { barbers, sessions, users, type User } from "@/db/schema";

const COOKIE = "barber_session";
const SESSION_DAYS = 7;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({ userId, token, expiresAt });
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token)).catch(() => {});
  }
  store.delete(COOKIE);
}

/**
 * A deactivated barbero loses panel access — they "no longer work here."
 * Admins keep access regardless of their own barberId's active flag:
 * deactivating yourself as a working barber must not lock you out of
 * managing the shop.
 */
export async function isAccountActive(user: User): Promise<boolean> {
  if (user.role !== "barbero" || !user.barberId) return true;
  const [barber] = await db.select({ active: barbers.active }).from(barbers).where(eq(barbers.id, user.barberId)).limit(1);
  return !!barber?.active;
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!rows.length) return null;
  const user = rows[0].user;

  // Checked live on every call, not just at login — see isAccountActive.
  if (!(await isAccountActive(user))) return null;

  return user;
}
