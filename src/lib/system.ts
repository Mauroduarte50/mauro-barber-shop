import { db } from "@/db";
import { notifications, auditLogs } from "@/db/schema";

/** Create an internal notification for a barber (never throws). */
export async function notify(
  barberId: string,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await db.insert(notifications).values({ barberId, type, title, body });
  } catch {
    // notifications must never break the booking flow
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
