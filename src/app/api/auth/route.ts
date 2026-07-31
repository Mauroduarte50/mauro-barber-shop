import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/system";
import { sanitizeText } from "@/lib/utils";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rec = attempts.get(ip);
  if (rec && rec.count >= 10 && rec.resetAt > Date.now()) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const email = sanitizeText(body.email, 100).toLowerCase();
  const password = String(body.password ?? "");

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    attempts.set(ip, { count: (rec?.count ?? 0) + 1, resetAt: Date.now() + 10 * 60_000 });
    return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }
  attempts.delete(ip);
  await createSession(user.id);
  await audit(user.id, user.name, "login", "Inicio de sesión");
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
