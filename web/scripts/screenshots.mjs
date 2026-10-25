#!/usr/bin/env node
// Captures the main screens in demo mode (used in CI; needs `playwright` installed).
//   BASE_URL=http://localhost:3000 OUT=shots node scripts/screenshots.mjs
import { mkdirSync, writeFileSync } from "node:fs";
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
let shareUrl = "";
await run("9-share-sheet", { width: 1440, height: 1000 }, async (p) => {
  await toResult(p);
  await p.click("text=Share deck");
  await p.waitForFunction(() => document.querySelector("[data-testid=share-url]")?.value.startsWith("http"), null, { timeout: 15000 });
  shareUrl = await p.inputValue("[data-testid=share-url]");
  console.log(`share link: ${shareUrl.length} characters`);
});
if (shareUrl) {
  await run("10-shared-page", { width: 1440, height: 1000 }, async (p) => {
    await p.goto(shareUrl, { waitUntil: "networkidle" });
    await p.waitForSelector(".deck", { timeout: 30000 });
    await p.waitForTimeout(2500);
    const tiles = await p.locator(".tile").count();
    const total = await p.locator(".tabs-total").innerText();
    console.log(`shared page: ${tiles} tiles, ${total}`);
    if (!/100 cards/.test(total)) errors.push("shared page does not show 100 cards");
  });
  // link previews: crawlers need og:image inside <head>
  for (const ua of ["WhatsApp/2.23.20.0 A", "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)", "facebookexternalhit/1.1"]) {
    const page = await (await fetch(shareUrl, { headers: { "user-agent": ua } })).text();
    const head = page.split("</head>")[0];
    const ok = /property="og:image"/.test(head);
    console.log(`preview for ${ua.split(/[ /]/)[0]}: og:image in <head> = ${ok}`);
    if (!ok) errors.push(`no og:image in <head> for ${ua}`);
  }
  // link preview: meta tags + the generated image
  const html = await (await fetch(shareUrl)).text();
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
  console.log(`og:title: ${ogTitle}`);
  if (!og) errors.push("no og:image on the shared page");
  else {
    const r = await fetch(og);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(`${out}/11-og-image.png`, buf);
    console.log(`og:image: HTTP ${r.status}, ${r.headers.get("content-type")}, ${Math.round(buf.length / 1024)} KB`);
    if (r.status !== 200 || !String(r.headers.get("content-type")).includes("image/png")) errors.push("og:image did not render");
  }
}
await run("12-mobile-share", { width: 390, height: 844 }, async (p) => {
  await toResult(p);
  await p.click("text=Share deck");
  await p.waitForTimeout(800);
});
await run("7-mobile-setup", { width: 390, height: 844 }, loadSeeds);
await run("8-mobile-result", { width: 390, height: 844 }, toResult);

await browser.close();
console.log(errors.length ? `Browser errors:\n${errors.join("\n")}` : "No browser errors");
if (errors.some((e) => !/net::ERR|Failed to load resource/.test(e))) process.exit(1);
