import { describe, expect, it } from "vitest";
import { thankYouWhatsAppMessage, waLink } from "@/lib/utils";

// Regression guard for the post-atendida WhatsApp thank-you button in
// /admin/appointments: the barber taps one button, WhatsApp opens pre-loaded
// with a warm message addressed to the CLIENT (not the barber), naming both
// the client and the configured barber — never a hardcoded person.
describe("thank-you WhatsApp message", () => {
  it("interpolates client name, business name and barber name", () => {
    const msg = thankYouWhatsAppMessage("Ana Torres", "Barbería Central", "Carlos Gómez");
    expect(msg).toContain("Ana Torres");
    expect(msg).toContain("Barbería Central");
    expect(msg).toContain("Carlos Gómez");
    expect(msg).not.toMatch(/mauro/i);
  });

  it("reflects a changed barber name with no trace of the previous one", () => {
    const before = thankYouWhatsAppMessage("Ana Torres", "Barbería Central", "Carlos Gómez");
    const after = thankYouWhatsAppMessage("Ana Torres", "Barbería Central", "Luis Rojas");
    expect(after).toContain("Luis Rojas");
    expect(after).not.toContain("Carlos Gómez");
    expect(before).not.toContain("Luis Rojas");
  });

  it("builds a wa.me link to the CLIENT's number (not the barber's), with the message URL-encoded", () => {
    const clientPhone = "+57 300 111 2233";
    const msg = thankYouWhatsAppMessage("Ana Torres", "Barbería Central", "Carlos Gómez");
    const link = waLink(clientPhone, msg);

    expect(link).toBe(`https://wa.me/573001112233?text=${encodeURIComponent(msg)}`);
    expect(decodeURIComponent(link.split("?text=")[1])).toBe(msg);
  });

  it("strips non-digit characters from the phone number regardless of formatting", () => {
    const link = waLink("+57 (300) 111-2233", "hola");
    expect(link.startsWith("https://wa.me/573001112233?")).toBe(true);
  });
});
