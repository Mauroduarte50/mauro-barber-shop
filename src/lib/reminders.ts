import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { appointments, barbers, clients } from "@/db/schema";
import { getAppSettings } from "@/lib/settings";
import { notify } from "@/lib/system";
import { fmtTime } from "@/lib/utils";

const REMINDER_LEAD_MIN = 30;
// The external scheduler that calls the cron endpoint runs roughly every
// 5 minutes and isn't guaranteed to land exactly on time, so we scan a
// window around the 30-minute mark rather than a single instant.
const REMINDER_WINDOW_MIN = 5;

export interface ReminderRunResult {
  sent: number;
  appointmentIds: string[];
}

/**
 * Finds confirmed appointments starting 25-35 minutes from `now` that
 * haven't had a reminder sent yet, and pushes one to the barber for each.
 * Each appointment is atomically claimed (UPDATE ... WHERE reminder_sent_at
 * IS NULL) before sending, so an overlapping run of this same job — or the
 * external scheduler firing twice for the same window — can never
 * double-send. `now` is an injectable param so tests don't depend on wall
 * clock time; production calls (the cron route) use the default.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const rangeStart = new Date(now.getTime() + (REMINDER_LEAD_MIN - REMINDER_WINDOW_MIN) * 60_000);
  const rangeEnd = new Date(now.getTime() + (REMINDER_LEAD_MIN + REMINDER_WINDOW_MIN) * 60_000);

  const activeBarbers = await db.select().from(barbers).where(eq(barbers.active, true));
  const appointmentIds: string[] = [];

  for (const barber of activeBarbers) {
    const settings = await getAppSettings(barber.id);
    if (!settings.remindersEnabled) continue;

    const due = await db
      .select({
        id: appointments.id,
        code: appointments.code,
        serviceName: appointments.serviceName,
        startTime: appointments.startTime,
        clientName: clients.name,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .where(
        and(
          eq(appointments.barberId, barber.id),
          eq(appointments.status, "confirmada"),
          isNull(appointments.reminderSentAt),
          gte(appointments.startTime, rangeStart),
          lt(appointments.startTime, rangeEnd),
        ),
      );

    for (const appt of due) {
      const claimed = await db
        .update(appointments)
        .set({ reminderSentAt: now })
        .where(and(eq(appointments.id, appt.id), isNull(appointments.reminderSentAt)))
        .returning({ id: appointments.id });
      if (!claimed.length) continue; // another run already claimed this one

      const time = fmtTime(appt.startTime, settings.timezone);
      await notify(
        barber.id,
        "reminder",
        "⏰ Recordatorio de cita",
        `${appt.clientName} tiene cita en 30 min (${time} — ${appt.serviceName})`,
        { url: `/admin/appointments?q=${appt.code}` },
      );
      appointmentIds.push(appt.id);
    }
  }

  return { sent: appointmentIds.length, appointmentIds };
}
