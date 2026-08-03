import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/reminders", () => ({
  sendDueReminders: vi.fn().mockResolvedValue({ sent: 0, appointmentIds: [] }),
}));

const { GET } = await import("@/app/api/cron/reminders/route");
const { sendDueReminders } = await import("@/lib/reminders");

// Regression guard: this endpoint runs unattended (an external scheduler
// hits it every ~5 min, not a logged-in admin), so it must reject anyone
// without the shared secret — otherwise it's a public endpoint anyone could
// spam to flood the barber's phone with fake reminder pushes.
describe("/api/cron/reminders auth", () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret-123";
    vi.mocked(sendDueReminders).mockClear();
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("rejects a request with no secret at all", async () => {
    const res = await GET(new Request("http://localhost/api/cron/reminders"));
    expect(res.status).toBe(401);
    expect(sendDueReminders).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer wrong" } }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the right secret via the Authorization header", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer test-secret-123" } }),
    );
    expect(res.status).toBe(200);
    expect(sendDueReminders).toHaveBeenCalledTimes(1);
  });

  it("accepts the right secret via the ?secret= query param fallback", async () => {
    const res = await GET(new Request("http://localhost/api/cron/reminders?secret=test-secret-123"));
    expect(res.status).toBe(200);
  });

  it("rejects everyone if CRON_SECRET isn't configured, instead of failing open", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(
      new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer test-secret-123" } }),
    );
    expect(res.status).toBe(401);
  });
});
