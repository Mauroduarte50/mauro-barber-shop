import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the "TURNOPLUS" system watermark: it must be
// centered small/discreet text (not a link), and must reserve horizontal
// clearance on mobile so it never sits under the floating dark/light
// toggle button (fixed bottom-4 right-4) regardless of scroll position —
// a real visual collision was caught and fixed while building this.
describe("BrandFooter component", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../src/components/brand-footer.tsx"), "utf-8");

  it("renders the TURNOPLUS wordmark", () => {
    expect(source).toContain("TURNOPLUS");
  });

  it("is not a link", () => {
    expect(source).not.toMatch(/<a\s/);
    expect(source).not.toContain("next/link");
  });

  it("reserves right-side clearance on mobile to clear the floating theme toggle", () => {
    expect(source).toMatch(/pr-\[70px\]/);
    expect(source).toMatch(/sm:px-0/);
  });

  it("is used in the public (root) layout paths and the admin layout, not duplicated logic", async () => {
    const landing = readFileSync(path.resolve(import.meta.dirname, "../src/app/page.tsx"), "utf-8");
    const reservar = readFileSync(path.resolve(import.meta.dirname, "../src/app/reservar/page.tsx"), "utf-8");
    const admin = readFileSync(path.resolve(import.meta.dirname, "../src/app/admin/layout.tsx"), "utf-8");
    for (const file of [landing, reservar, admin]) {
      expect(file).toMatch(/import\s+\{\s*BrandFooter\s*\}\s+from\s+["']@\/components\/brand-footer["']/);
      expect(file).toMatch(/<BrandFooter/);
    }
  });
});
