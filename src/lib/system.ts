import { db } from "@/db";
import { notifications, auditLogs } from "@/db/schema";
import { sendPushToBarber } from "@/lib/push";

/**
 * Create an internal notification for a barber and push it to every device
 * they've enabled push notifications on (never throws — this must never
 * break the booking flow that triggered it).
 */
export async function notify(
  barberId: string,
  type: string,
  title: string,
  body: string,
  opts?: { url?: string },
): Promise<void> {
  try {
    await db.insert(notifications).values({ barberId, type, title, body });
  } catch {
    // notifications must never break the booking flow
  }
  try {
    await sendPushToBarber(barberId, { title, body, url: opts?.url ?? "/admin" });
  } catch {
    // push must never break the booking flow either
  }
}

/** Append an audit log entry (never throws). */
export async function audit(
  userId: string | null,
  userName: string,
  action: string,
  details: string,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({ userId, userName, action, details });
  } catch {
    // ignore
  }
}
