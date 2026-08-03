import { NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/reminders";

// Always hits the DB fresh — never statically optimized/cached.
export const dynamic = "force-dynamic";

// Not triggered by Vercel's own Cron (Hobby plan caps cron at once/day, too
// coarse for a 30-min-before reminder) — an external scheduler (cron-job.org
// or similar) calls this endpoint every ~5 minutes instead. Since Vercel
// won't inject its usual cron auth header for a third-party caller, the
// secret is checked explicitly here: either an `Authorization: Bearer`
// header (preferred — set it as a custom header in the scheduler) or a
// `?secret=` query param (fallback for schedulers that can't set headers).
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendDueReminders();
  return NextResponse.json({ ok: true, ...result });
}
