// One-off generator for placeholder brand images (no real barbershop photos yet).
// Run with: node scripts/gen-placeholder-images.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const DARK = "#0c0a09";
const DARK2 = "#1c1917";
const AMBER = "#f59e0b";
const AMBER_DARK = "#d97706";

mkdirSync("public/images", { recursive: true });

const scissorsPath =
  "M9.5 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm0 11a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM8.12 8.66 19 19M19 5 8.12 15.34";

function heroSvg(w, h) {
  const stripes = Array.from({ length: 6 }, (_, i) => {
    const x = w * 0.06 + i * (w * 0.02);
    return `<rect x="${x}" y="0" width="${w * 0.008}" height="${h}" fill="${AMBER}" opacity="0.06" transform="skewX(-12)"/>`;
  }).join("");
  const cx = w / 2;
  const cy = h / 2 - h * 0.03;
  const s = Math.min(w, h) * 0.16;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="${DARK2}"/>
      <stop offset="100%" stop-color="${DARK}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${stripes}
  <g transform="translate(${cx - s},${cy - s}) scale(${(s * 2) / 24})" stroke="${AMBER}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
    <path d="${scissorsPath}"/>
  </g>
  <text x="${cx}" y="${cy + s * 1.9}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="${w * 0.045}" fill="#ffffff" letter-spacing="${w * 0.004}">MAURO BARBER SHOP</text>
  <text x="${cx}" y="${cy + s * 2.6}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="600" font-size="${w * 0.02}" fill="${AMBER}" letter-spacing="${w * 0.003}">ESTILO CLÁSICO · CORTES DE PRECISIÓN</text>
</svg>`;
}

function portraitSvg(w, h) {
  const cx = w / 2;
  const cy = h * 0.42;
  const s = Math.min(w, h) * 0.22;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${DARK2}"/>
      <stop offset="100%" stop-color="${DARK}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg2)"/>
  <circle cx="${cx}" cy="${cy}" r="${s * 1.35}" fill="none" stroke="${AMBER}" stroke-width="${w * 0.006}" opacity="0.5"/>
  <g transform="translate(${cx - s / 2},${cy - s / 2}) scale(${s / 24})" stroke="${AMBER}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${scissorsPath}"/>
  </g>
  <text x="${cx}" y="${h * 0.82}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="${w * 0.075}" fill="#ffffff">MAURO</text>
  <text x="${cx}" y="${h * 0.89}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="600" font-size="${w * 0.045}" fill="${AMBER}" letter-spacing="${w * 0.006}">BARBER</text>
</svg>`;
}

function iconSvg(size) {
  const s = size * 0.5;
  const cx = size / 2;
  const cy = size / 2;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${DARK}"/>
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="none" stroke="${AMBER_DARK}" stroke-width="${size * 0.02}"/>
  <g transform="translate(${cx - s / 2},${cy - s / 2}) scale(${s / 24})" stroke="${AMBER}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${scissorsPath}"/>
  </g>
</svg>`;
}

async function main() {
  await sharp(Buffer.from(heroSvg(1600, 900))).jpeg({ quality: 88 }).toFile("public/images/hero.jpg");
  await sharp(Buffer.from(portraitSvg(800, 1000))).jpeg({ quality: 88 }).toFile("public/images/barber.jpg");
  await sharp(Buffer.from(iconSvg(192))).png().toFile("public/images/icon-192.png");
  await sharp(Buffer.from(iconSvg(512))).png().toFile("public/images/icon-512.png");
  console.log("Placeholder images generated in public/images/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
