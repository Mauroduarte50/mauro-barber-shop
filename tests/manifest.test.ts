import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as adminManifestRoute } from "../src/app/admin-manifest.webmanifest/route";

// Regression guard for the bug where a home-screen icon installed from
// /admin opened the public booking page instead: iOS 16.4+ uses the Web
// App Manifest (not the URL it was installed from) to decide where an
// installed PWA opens, so /admin needs its own manifest with its own
// start_url/scope, and the admin layout must actually link to it instead
// of inheriting the root (client) manifest.
//
// Both manifests are served dynamically (not static public/ files) so
// their `name`/`short_name` always reflect the configured business name
// instead of a value baked in at build time.

describe("PWA manifests: client vs admin install must not collide", () => {
  it("the admin manifest route opens straight into /admin", async () => {
    const res = await adminManifestRoute();
    const manifest = await res.json();
    expect(manifest.start_url).toBe("/admin");
    expect(manifest.id).toBe("/admin");
  });

  // Regression guard: scope used to be "/admin", which excludes /login.
  // /login is reached from inside the installed admin app whenever the
  // session cookie has expired (or via logout) — since it's outside
  // "/admin", the standalone window was forced to break out into a regular
  // browser tab/window to show it (spec-mandated for out-of-scope
  // navigations), which surfaced as the installed icon "reusing an open
  // Safari tab" instead of showing /login in the app. Scope must stay wide
  // enough to cover /login; `id` (not `scope`) is what keeps this a
  // distinct installed app from the client manifest.
  it("the admin manifest scope covers /login so an expired session doesn't break out of the standalone app", async () => {
    const res = await adminManifestRoute();
    const manifest = await res.json();
    expect("/login".startsWith(manifest.scope)).toBe(true);
  });

  it("the admin manifest is served with the manifest content type, not plain JSON", async () => {
    const res = await adminManifestRoute();
    expect(res.headers.get("Content-Type")).toBe("application/manifest+json");
  });

  it("the client manifest (app/manifest.ts) opens at / and is scoped to /", async () => {
    const { default: manifest } = await import("../src/app/manifest");
    const m = await manifest();
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("the admin layout overrides the metadata.manifest field so /admin pages never inherit the client manifest", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/admin/layout.tsx"), "utf-8");
    expect(source).toMatch(/manifest:\s*["']\/admin-manifest\.webmanifest["']/);
  });

  it("client and admin manifests reference different icon files, so the two home-screen icons look different", async () => {
    const res = await adminManifestRoute();
    const adminManifest = (await res.json()) as { icons: { src: string }[] };
    const { default: clientManifestFn } = await import("../src/app/manifest");
    const clientManifest = await clientManifestFn();

    const adminSrcs = adminManifest.icons.map((i) => i.src);
    const clientSrcs = (clientManifest.icons ?? []).map((i) => i.src);
    expect(adminSrcs.every((src) => src.includes("icon-admin"))).toBe(true);
    expect(adminSrcs.some((src) => clientSrcs.includes(src))).toBe(false);
  });

  it("both manifests derive their name from settings.businessName, with no personal name hardcoded in source", () => {
    const adminSource = readFileSync(
      path.resolve(import.meta.dirname, "../src/app/admin-manifest.webmanifest/route.ts"),
      "utf-8",
    );
    const clientSource = readFileSync(path.resolve(import.meta.dirname, "../src/app/manifest.ts"), "utf-8");
    for (const source of [adminSource, clientSource]) {
      expect(source).toMatch(/settings\.businessName/);
      expect(source).not.toMatch(/mauro/i);
    }
  });
});
