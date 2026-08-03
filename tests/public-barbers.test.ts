import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { barbers } from "@/db/schema";
import { GET as getBarbers } from "@/app/api/public/barbers/route";
import { POST as createBooking, GET as lookupByPhone } from "@/app/api/public/bookings/route";
import { addDaysStr, todayStrInTz } from "@/lib/utils";
import { setupTestBarber, teardownTestBarber, type TestFixture } from "./helpers";

const TZ = "America/Bogota";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/public/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public multi-barber endpoints", () => {
  let a: TestFixture;
  let b: TestFixture;

  afterAll(async () => {
    await teardownTestBarber("a");
    await teardownTestBarber("b");
  });

  it("GET /api/public/barbers returns only active barbers", async () => {
    a = await setupTestBarber("a");
    b = await setupTestBarber("b");
    await db.update(barbers).set({ active: false }).where(eq(barbers.id, b.barber.id));

    const res = await getBarbers();
    const data = await res.json();
    const slugs = data.barbers.map((x: { slug: string }) => x.slug);
    expect(slugs).toContain(a.barber.slug);
    expect(slugs).not.toContain(b.barber.slug);

    await db.update(barbers).set({ active: true }).where(eq(barbers.id, b.barber.id));
  });

  it("finding bookings by phone searches across every barber, not just one", async () => {
    const phone = "3007770001";
    const date = addDaysStr(todayStrInTz(TZ), 33);
    const bookedA = await createBooking(
      jsonRequest({ barber: a.barber.slug, serviceId: a.service30.id, date, startMin: 9 * 60, name: "Cliente Multi", phone }),
    );
    const bookedB = await createBooking(
      jsonRequest({ barber: b.barber.slug, serviceId: b.service30.id, date, startMin: 11 * 60, name: "Cliente Multi", phone }),
    );
    expect(bookedA.status).toBe(200);
    expect(bookedB.status).toBe(200);
    const { booking: aBooking } = await bookedA.json();
    const { booking: bBooking } = await bookedB.json();

    const res = await lookupByPhone(new Request(`http://localhost/api/public/bookings?phone=${phone}`));
    const data = await res.json();
    const codes = data.bookings.map((x: { code: string }) => x.code);
    expect(codes).toContain(aBooking.code);
    expect(codes).toContain(bBooking.code);
    const rowA = data.bookings.find((x: { code: string }) => x.code === aBooking.code);
    const rowB = data.bookings.find((x: { code: string }) => x.code === bBooking.code);
    expect(rowA.barberName).toBe(a.barber.name);
    expect(rowB.barberName).toBe(b.barber.name);
  });
});
