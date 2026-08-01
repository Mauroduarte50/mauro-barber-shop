import webPush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:soporte@barberia.com";
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/**
 * Sends a Web Push notification to every device the barber has subscribed
 * (phone, tablet, etc). Never throws — a push failure must never break the
 * booking flow that triggered it. Silently no-ops if VAPID keys aren't
 * configured yet (e.g. not set in Vercel env vars).
 */
export async function sendPushToBarber(barberId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  let subs: (typeof pushSubscriptions.$inferSelect)[];
  try {
    subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.barberId, barberId));
  } catch {
    return;
  }
  if (!subs.length) return;

  const json = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/admin",
  });

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webPush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json);
      } catch (e: unknown) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        // 404/410: the subscription was revoked (uninstalled, permission
        // reset) — the endpoint is dead forever, so stop retrying it.
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {});
        }
      }
    }),
  );
}
