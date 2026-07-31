import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "C:/Users/Usuario/AppData/Local/Temp/claude/C--Maurobarber/9a4e39bc-02f5-40f5-8e27-f719f199d9cb/scratchpad/screenshots";
const results = [];

async function checkPage(page, name, path, { dark = false } = {}) {
  const errors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  };
  const onPageError = (err) => errors.push(String(err));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => errors.push("nav failed: " + e.message));
  await page.waitForTimeout(400);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const hScroll = scrollWidth > clientWidth + 2; // small tolerance

  const fname = `${name}${dark ? "-dark" : ""}.png`;
  await page.screenshot({ path: `${OUT}/${fname}`, fullPage: true }).catch((e) => errors.push("screenshot failed: " + e.message));

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  results.push({ name, path, dark, hScroll, scrollWidth, clientWidth, errors });
  console.log(`[${dark ? "dark" : "light"}] ${path} -> hScroll=${hScroll} (${scrollWidth}px/${clientWidth}px) errors=${errors.length}`);
  if (errors.length) errors.forEach((e) => console.log("   ERROR:", e.slice(0, 200)));
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();

  // ---- Public pages, mobile, dark (default theme) ----
  await checkPage(page, "landing", "/", { dark: true });
  await checkPage(page, "reservar-step1", "/reservar", { dark: true });

  // Drive the booking wizard for real: service -> date -> time -> details -> confirm
  await page.click("text=Corte clásico").catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/reservar-step2-date.png`, fullPage: true });
  const dateChip = page.locator("button:has-text('libres')").first();
  if (await dateChip.count()) {
    await dateChip.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/reservar-step3-time.png`, fullPage: true });
    const slotBtn = page.locator("button:has-text('Disponible')").first();
    if (await slotBtn.count()) {
      await slotBtn.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/reservar-step4-details.png`, fullPage: true });
      await page.fill("input[placeholder='Juan Pérez']", "Cliente Playwright");
      await page.fill("input[placeholder='300 123 4567']", "3009998877");
      await page.click("text=Confirmar reserva");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/reservar-step5-confirm.png`, fullPage: true });
      await page.click("text=Sí, confirmar").catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  const successCheck = await page.evaluate(() => {
    const w = document.documentElement.scrollWidth;
    const c = document.documentElement.clientWidth;
    return { hScroll: w > c + 2, w, c, hasCode: document.body.innerText.includes("Código") };
  });
  await page.screenshot({ path: `${OUT}/reservar-success.png`, fullPage: true });
  console.log("booking success screen:", JSON.stringify(successCheck));
  results.push({ name: "reservar-success", path: "/reservar (final)", dark: true, ...successCheck, errors: [] });

  // extract the real booking code for the /cita/[code] test
  const bodyText = await page.evaluate(() => document.body.innerText);
  const codeMatch = bodyText.match(/BAR-\d{8}-\d{4}/);
  const code = codeMatch ? codeMatch[0] : null;
  console.log("Extracted booking code:", code);

  await checkPage(page, "cita-buscar", "/cita/buscar", { dark: true });
  if (code) await checkPage(page, "cita-detalle", `/cita/${code}`, { dark: true });

  // ---- Light mode variant of a couple of key screens ----
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const themeToggle = page.locator('button[aria-label="Cambiar tema"]');
  if (await themeToggle.count()) await themeToggle.click();
  await page.waitForTimeout(300);
  await checkPage(page, "landing", "/", { dark: false });
  await checkPage(page, "reservar-step1", "/reservar", { dark: false });

  // ---- Admin: login then walk every subpage ----
  await checkPage(page, "login", "/login", { dark: false });
  await page.fill('input[type="email"]', "admin@barberia.com").catch(async () => {
    await page.fill('input[name="email"]', "admin@barberia.com");
  });
  await page.fill('input[type="password"]', "admin123").catch(async () => {
    await page.fill('input[name="password"]', "admin123");
  });
  await page.click('button[type="submit"], button:has-text("Entrar"), button:has-text("Iniciar")').catch(() => {});
  await page.waitForTimeout(1000);

  const adminPages = [
    "admin-dashboard", "/admin",
    "admin-calendar", "/admin/calendar",
    "admin-appointments", "/admin/appointments",
    "admin-clients", "/admin/clients",
    "admin-services", "/admin/services",
    "admin-schedule", "/admin/schedule",
    "admin-blocks", "/admin/blocks",
    "admin-income", "/admin/income",
    "admin-stats", "/admin/stats",
    "admin-notifications", "/admin/notifications",
    "admin-settings", "/admin/settings",
  ];
  for (let i = 0; i < adminPages.length; i += 2) {
    await checkPage(page, adminPages[i], adminPages[i + 1], { dark: false });
  }

  await browser.close();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log("\n=== SUMMARY ===");
  const bad = results.filter((r) => r.hScroll || (r.errors && r.errors.length));
  if (bad.length) {
    console.log("ISSUES FOUND:");
    bad.forEach((r) => console.log(" -", r.name, r.dark ? "(dark)" : "(light)", "hScroll:", r.hScroll, "errors:", r.errors?.length));
  } else {
    console.log("No horizontal scroll or console errors detected on any page.");
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
