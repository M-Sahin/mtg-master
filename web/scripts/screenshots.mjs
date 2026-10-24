#!/usr/bin/env node
// Captures the main screens in demo mode (used in CI; needs `playwright` installed).
//   BASE_URL=http://localhost:3000 OUT=shots node scripts/screenshots.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.env.OUT ?? "shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function run(name, viewport, steps) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(base, { waitUntil: "networkidle" });
  await steps(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await page.close();
}

const loadSeeds = async (p) => {
  await p.click("text=Load the demo seeds");
  await p.waitForFunction(() => document.querySelectorAll(".flip.is-flipped").length === 5, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
};
const toResult = async (p) => {
  await loadSeeds(p);
  await p.click("text=Build my deck");
  await p.waitForSelector(".deck", { timeout: 120000 });
  await p.waitForTimeout(2500);
};

await run("1-setup-empty", { width: 1440, height: 1000 }, async () => {});
await run("2-setup-seeds", { width: 1440, height: 1000 }, loadSeeds);
await run("3-building", { width: 1440, height: 1000 }, async (p) => {
  await loadSeeds(p);
  await p.click("text=Build my deck");
  await p.waitForFunction(() => document.querySelectorAll(".cell.is-in").length > 35, null, { timeout: 120000 });
});
await run("4-result", { width: 1440, height: 1000 }, toResult);
await run("5-numbers", { width: 1440, height: 1000 }, async (p) => {
  await toResult(p);
  await p.click("role=tab[name=Numbers]");
  await p.waitForTimeout(800);
});
await run("6-hand", { width: 1440, height: 1000 }, async (p) => {
  await toResult(p);
  await p.click('role=tab[name="Draw a hand"]');
  await p.waitForTimeout(2000);
});
await run("7-mobile-setup", { width: 390, height: 844 }, loadSeeds);
await run("8-mobile-result", { width: 390, height: 844 }, toResult);

await browser.close();
console.log(errors.length ? `Browser errors:\n${errors.join("\n")}` : "No browser errors");
