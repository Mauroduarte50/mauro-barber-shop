import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard: the mobile top-bar nav is a hand-built chip list
// (separate from the desktop sidebar's NAV.map), and "Cerrar sesión" was
// only ever added to the desktop sidebar, so it silently didn't exist on
// mobile at all.
describe("admin mobile nav includes logout", () => {
  it("the mobile nav renders a logout control wired to the same logoutAction as desktop", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/admin/layout.tsx"), "utf-8");
    const mobileNavMatch = source.match(/<nav className="scrollbar-hide[\s\S]*?<\/nav>/);
    expect(mobileNavMatch).not.toBeNull();
    expect(mobileNavMatch![0]).toMatch(/logoutAction/);
  });
});
