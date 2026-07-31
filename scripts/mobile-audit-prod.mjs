import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = "https://mauro-barber-shop.vercel.app";
const ADMIN_EMAIL = "admin2026@gmail.com";
const ADMIN_PASSWORD = "admin123.";

const PROFILES = [
  { name: "iphone", device: devices["iPhone 13"] }, // 390px
  { name: "android", device: { ...devices["Galaxy S8"], viewport: { width: 360, height: 800 } } }, // 360px
];

const OUT_ROOT = "C:/Users/Usuario/AppData/Local/Temp/claude/C--Maurobarber/9a4e39bc-02f5-40f5-8e27-f719f199d9cb/scratchpad";

async function measureTapTargets(page, selector) {
  return page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    const small = [];
    for (const el of els) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 40 || r.width < 32) {
        small.push({
          tag: el.tagName,
          text: (el.textContent || "").trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return small;
  }, selector);
}

async function checkPage(page, out, name, path, { dark = false, fullPage = true } = {}) {
  const errors = [];
  const onConsole = (msg) => { if (msg.type() === "error") errors.push(msg.text()); };
  const onPageError = (err) => errors.push(String(err));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 25000 }).catch((e) => errors.push("nav failed: " + e.message));
  await page.waitForTimeout(500);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const hScroll = scrollWidth > clientWidth + 2;
  const smallTargets = await measureTapTargets(page, "button, a.btn-primary, a.btn-ghost, a.btn-dark, a[href]");

  const fname = `${name}${dark ? "-dark" : ""}.png`;
  await page.screenshot({ path: `${out}/${fname}`, fullPage }).catch((e) => errors.push("screenshot failed: " + e.message));

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  const result = { name, path, dark, hScroll, scrollWidth, clientWidth, errors, smallTargets: smallTargets.length };
  console.log(
    `  [${dark ? "dark" : "light"}] ${path} -> hScroll=${hScroll} (${scrollWidth}/${clientWidth}) errors=${errors.length} smallTargets=${smallTargets.length}`,
  );
  if (errors.length) errors.forEach((e) => console.log("     ERROR:", e.slice(0, 150)));
  if (smallTargets.length) smallTargets.slice(0, 5).forEach((t) => console.log("     SMALL:", JSON.stringify(t)));
  return result;
}

async function runProfile(profile) {
  const out = `${OUT_ROOT}/screenshots-prod-${profile.name}`;
  fs.mkdirSync(out, { recursive: true });
  console.log(`\n===== PROFILE: ${profile.name} (${profile.device.viewport.width}px) =====`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ ...profile.device });
  const page = await context.newPage();
  const results = [];

  // ---- Public, dark (default) ----
  results.push(await checkPage(page, out, "landing", "/", { dark: true }));
  results.push(await checkPage(page, out, "reservar-step1", "/reservar", { dark: true }));

  await page.locator("button.card").first().click({ timeout: 5000 }).catch((e) => console.log("  step1 click failed:", e.message));
  await page.locator("h2", { hasText: "Elige la fecha" }).waitFor({ timeout: 8000 }).catch((e) => console.log("  step2 heading wait failed:", e.message));
  await page.locator("button:has-text('libres')").first().waitFor({ timeout: 8000 }).catch((e) => console.log("  date chips wait failed:", e.message));
  await page.screenshot({ path: `${out}/reservar-step2-date.png`, fullPage: true }).catch(() => {});
  const dateChip = page.locator("button:has-text('libres')").first();
  console.log("  date chips available:", await page.locator("button:has-text('libres')").count());
  if (await dateChip.count()) {
    await dateChip.click({ timeout: 5000 });
    await page.locator("h2", { hasText: "Elige la hora" }).waitFor({ timeout: 8000 }).catch((e) => console.log("  step3 heading wait failed:", e.message));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/reservar-step3-time.png`, fullPage: true }).catch(() => {});
    const timeButtons = await measureTapTargets(page, "button");
    console.log("  step3 small tap targets:", timeButtons.length, JSON.stringify(timeButtons.slice(0, 3)));
    const slotBtn = page.locator("button:has-text('Disponible')").first();
    console.log("  available slots:", await page.locator("button:has-text('Disponible')").count());
    if (await slotBtn.count()) {
      await slotBtn.click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/reservar-step4-details.png`, fullPage: true }).catch(() => {});
      const phoneInputMode = await page.locator("input[placeholder='300 123 4567']").getAttribute("inputmode").catch(() => null);
      console.log("  phone input inputmode attr:", phoneInputMode);
      await page.fill("input[placeholder='Juan Pérez']", `Auditoria ${profile.name}`);
      await page.fill("input[placeholder='300 123 4567']", "3001234567");
      await page.locator("button", { hasText: "Confirmar reserva" }).click({ timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/reservar-step5-confirm.png`, fullPage: true }).catch(() => {});
      await page.locator("button", { hasText: "Sí, confirmar" }).click({ timeout: 5000 }).catch((e) => console.log("  final confirm failed:", e.message));
      await page.waitForTimeout(1000);
    }
  }
  await page.screenshot({ path: `${out}/reservar-success.png`, fullPage: true }).catch(() => {});
  const bodyText = await page.evaluate(() => document.body.innerText);
  const codeMatch = bodyText.match(/BAR-\d{8}-\d{4}/);
  const code = codeMatch ? codeMatch[0] : null;
  console.log("  Extracted booking code:", code);
  const successCheck = await page.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));
  results.push({ name: "reservar-success", path: "/reservar(final)", dark: true, ...successCheck, errors: [] });

  results.push(await checkPage(page, out, "cita-buscar", "/cita/buscar", { dark: true }));
  if (code) results.push(await checkPage(page, out, "cita-detalle", `/cita/${code}`, { dark: true }));

  // ---- Light mode ----
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const themeToggle = page.locator('button[aria-label="Cambiar tema"]');
  if (await themeToggle.count()) await themeToggle.click();
  await page.waitForTimeout(300);
  results.push(await checkPage(page, out, "landing", "/", { dark: false }));
  results.push(await checkPage(page, out, "reservar-step1", "/reservar", { dark: false }));
  results.push(await checkPage(page, out, "login", "/login", { dark: false }));

  // ---- Admin login ----
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"], button:has-text("Entrar"), button:has-text("Iniciar")');
  await page.waitForURL(/\/admin/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

  const adminPages = [
    ["admin-dashboard", "/admin"],
    ["admin-appointments", "/admin/appointments"],
    ["admin-clients", "/admin/clients"],
    ["admin-services", "/admin/services"],
    ["admin-schedule", "/admin/schedule"],
    ["admin-blocks", "/admin/blocks"],
    ["admin-income", "/admin/income"],
    ["admin-stats", "/admin/stats"],
    ["admin-notifications", "/admin/notifications"],
    ["admin-settings", "/admin/settings"],
  ];
  for (const [name, path] of adminPages) {
    results.push(await checkPage(page, out, name, path, { dark: false }));
  }

  // ---- Calendar: day / week / month ----
  await page.goto(BASE + "/admin/calendar", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  for (const [label, name] of [["Día", "admin-calendar-day"], ["Semana", "admin-calendar-week"], ["Mes", "admin-calendar-month"]]) {
    await page.click(`button:has-text("${label}")`);
    await page.waitForTimeout(600);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const hScroll = scrollWidth > clientWidth + 2;
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }).catch(() => {});
    console.log(`  [calendar] ${label} -> hScroll(page)=${hScroll} (${scrollWidth}/${clientWidth})`);
    results.push({ name, path: `/admin/calendar (${label})`, dark: false, hScroll, scrollWidth, clientWidth, errors: [] });
  }

  await browser.close();
  return results;
}

async function main() {
  const all = [];
  for (const profile of PROFILES) {
    const r = await runProfile(profile);
    all.push({ profile: profile.name, results: r });
  }
  fs.writeFileSync(`${OUT_ROOT}/results-prod.json`, JSON.stringify(all, null, 2));

  console.log("\n===== SUMMARY =====");
  for (const { profile, results } of all) {
    const bad = results.filter((r) => r.hScroll || (r.errors && r.errors.length) || (r.smallTargets ?? 0) > 0);
    console.log(`\n${profile}: ${bad.length ? "ISSUES" : "clean"}`);
    bad.forEach((r) =>
      console.log(
        `  - ${r.name} ${r.dark ? "(dark)" : "(light)"} hScroll=${r.hScroll} errors=${r.errors?.length ?? 0} smallTargets=${r.smallTargets ?? 0}`,
      ),
    );
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
