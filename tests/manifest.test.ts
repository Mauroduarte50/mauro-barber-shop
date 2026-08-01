import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the bug where a home-screen icon installed from
// /admin opened the public booking page instead: iOS 16.4+ uses the Web
// App Manifest (not the URL it was installed from) to decide where an
// installed PWA opens, so /admin needs its own manifest with its own
// start_url/scope, and the admin layout must actually link to it instead
// of inheriting the root (client) manifest.

describe("PWA manifests: client vs admin install must not collide", () => {
  it("public/admin-manifest.webmanifest opens straight into /admin, scoped to /admin", () => {
    const raw = readFileSync(path.resolve(import.meta.dirname, "../public/admin-manifest.webmanifest"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.start_url).toBe("/admin");
    expect(manifest.scope).toBe("/admin");
  });

  it("the client manifest (app/manifest.ts) opens at / and is scoped to /", async () => {
    const { default: manifest } = await import("../src/app/manifest");
    const m = manifest();
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("the admin layout overrides the metadata.manifest field so /admin pages never inherit the client manifest", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/admin/layout.tsx"), "utf-8");
    expect(source).toMatch(/manifest:\s*["']\/admin-manifest\.webmanifest["']/);
  });

  it("client and admin manifests reference different icon files, so the two home-screen icons look different", async () => {
    const raw = readFileSync(path.resolve(import.meta.dirname, "../public/admin-manifest.webmanifest"), "utf-8");
    const adminManifest = JSON.parse(raw) as { icons: { src: string }[] };
    const { default: clientManifestFn } = await import("../src/app/manifest");
    const clientManifest = clientManifestFn();

    const adminSrcs = adminManifest.icons.map((i) => i.src);
    const clientSrcs = (clientManifest.icons ?? []).map((i) => i.src);
    expect(adminSrcs.every((src) => src.includes("icon-admin"))).toBe(true);
    expect(adminSrcs.some((src) => clientSrcs.includes(src))).toBe(false);
  });
});
