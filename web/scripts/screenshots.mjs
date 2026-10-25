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
    if (buf.length > 300 * 1024) errors.push(`og:image is ${Math.round(buf.length / 1024)} KB; WhatsApp only shows previews up to ~300 KB`);
  }
}
await run("12-mobile-share", { width: 390, height: 844 }, async (p) => {
  await toResult(p);
  await p.click("text=Share deck");
  await p.waitForTimeout(800);
});
// the phone switches apps mid-build: the stream breaks off, the page reconnects and the deck still arrives
await run("13-dropped-stream", { width: 390, height: 844 }, async (p) => {
  await p.route("**/api/generate", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const resp = await route.fetch();
    const lines = (await resp.text()).split("\n");
    await route.fulfill({ response: resp, body: lines.slice(0, 40).join("\n") + "\n" }); // cut off mid-build, no "done"
  });
  const reconnects = [];
  p.on("request", (r) => r.method() === "GET" && r.url().includes("/api/generate?job=") && reconnects.push(r.url()));
  await loadSeeds(p);
  await p.click("text=Build my deck");
  await p.waitForSelector(".deck", { timeout: 120000 });
  const body = await p.locator("body").innerText();
  console.log(`dropped stream: deck arrived after ${reconnects.length} reconnect(s): ${reconnects.map((u) => u.split("&")[1]).join(", ")}`);
  if (!reconnects.length) errors.push("the page never reconnected after the stream was cut");
  if (/connection to the build was lost|isn't running anymore|connection dropped/i.test(body)) errors.push("build was lost after the stream dropped");
});
// switching apps and coming back: the page must reconnect right away, not wait for a dead socket
await run("14-switch-apps", { width: 390, height: 844 }, async (p) => {
  const gets = [];
  p.on("response", (r) => r.request().method() === "GET" && r.url().includes("/api/generate?job=") && gets.push(Date.now()));
  await loadSeeds(p);
  await p.click("text=Build my deck");
  await p.waitForTimeout(1000); // the demo build takes ~9 s: switch away early
  const setVis = (state) =>
    p.evaluate((st) => {
      Object.defineProperty(document, "visibilityState", { value: st, configurable: true });
      Object.defineProperty(document, "hidden", { value: st === "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await setVis("hidden");
  await p.waitForTimeout(2500);
  const running = (await p.locator(".deck").count()) === 0;
  const back = Date.now();
  await setVis("visible");
  await p.waitForSelector(".deck", { timeout: 120000 });
  const first = gets.find((t) => t >= back);
  console.log(`switch apps: reconnected ${first ? `${first - back} ms` : "never"} after coming back (build still running then: ${running})`);
  if (running && (!first || first - back > 3000)) errors.push(`slow or no reconnect after coming back (${first ? first - back : "none"} ms)`);
});
// own key panel: a made-up key is refused by Anthropic with a readable message
await run("15-own-key", { width: 1440, height: 1000 }, async (p) => {
  // password managers need a form with a username and a current-password field
  const form = await p.evaluate(() => {
    const f = document.querySelector("[data-testid=api-key]")?.closest("form");
    return f ? { user: !!f.querySelector("input[autocomplete=username]"), pass: !!f.querySelector("input[type=password][autocomplete=current-password]"), submit: !!f.querySelector("button[type=submit]") } : null;
  });
  console.log(`key form for password managers: ${JSON.stringify(form)}`);
  if (!form || !form.user || !form.pass || !form.submit) errors.push("the key field isn't a form a password manager can save");
  await p.fill("[data-testid=api-key]", "sk-ant-api03-" + "x".repeat(60));
  await p.press("[data-testid=api-key]", "Enter"); // submitting the form checks the key
  await p.waitForSelector(".keypanel .error", { timeout: 20000 });
  const msg = await p.locator(".keypanel .error").innerText();
  console.log(`own key with a fake key: "${msg}"`);
  if (!/didn't accept this API key|Key check failed/.test(msg)) errors.push(`unexpected key error: ${msg}`);
});
// collection panel: paste a list
await run("16-collection", { width: 1440, height: 1000 }, async (p) => {
  await p.click("text=Add my collection");
  await p.fill("textarea[aria-label='Paste your collection']", "1 Sol Ring\n1x Arcane Signet (CMR) 297\nMeren of Clan Nel Toth");
  await p.click("text=Use this list");
  await p.waitForSelector("text=3 cards", { timeout: 5000 });
  await p.click("text=Only my cards");
});
// the security policy: a fresh nonce per request on every script
{
  const res = await fetch(base);
  const csp = res.headers.get("content-security-policy") ?? "";
  const html = await res.text();
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const without = scripts.filter((t) => !nonce || !t.includes(`nonce="${nonce}"`));
  console.log(`CSP: ${csp ? "set" : "MISSING"}; ${scripts.length} script tags, ${without.length} without the nonce`);
  if (!nonce) errors.push("no Content-Security-Policy nonce on the home page");
  if (without.length) errors.push(`scripts without the CSP nonce: ${without.slice(0, 3).join(" ")}`);
}
// the free bracket checker on a short list with Game Changers and a known combo
await run("17-bracket-checker", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}/bracket`, { waitUntil: "networkidle" });
  await p.fill("[data-testid=bracket-list]", "Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n1 Demonic Tutor\n1 Bolas's Citadel\n1 Gravecrawler\n1 Phyrexian Altar\n1 Sakura-Tribe Elder\n10 Swamp\n10 Forest");
  await p.click("text=Check the bracket");
  await p.waitForSelector(".bracket-badge", { timeout: 60000 });
  const badge = await p.locator(".bracket-badge strong").innerText();
  const reasons = await p.locator(".bracket-reasons li").allInnerTexts();
  console.log(`bracket checker: ${badge}; ${reasons.length} reason(s): ${reasons.map((r) => r.split("\n")[0].slice(0, 90)).join(" | ")}`);
  if (!/Bracket [34]/.test(badge)) errors.push(`bracket checker gave ${badge}`);
});
// the header must fit on one row on a phone, on every page
for (const [name, path] of [["18-mobile-bracket", "/bracket"], ["19-mobile-home-header", "/"]]) {
  await run(name, { width: 360, height: 740 }, async (p) => {
    await p.goto(`${base}${path}`, { waitUntil: "networkidle" });
    const box = await p.locator("header.top").boundingBox();
    const overflow = await p.evaluate(() => Math.max(...[...document.querySelectorAll("header.top *")].map((e) => e.getBoundingClientRect().right)) - window.innerWidth);
    if (overflow > 1) errors.push(`header on ${path} runs ${Math.round(overflow)}px off the screen on a phone`);
    const items = await p.locator("header.top > *").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    console.log(`header on ${path} at 360px: ${Math.round(box?.height ?? 0)}px tall, items ${items.map(Math.round).join("/")}px`);
    if ((box?.height ?? 0) > 80) errors.push(`header on ${path} wraps on a phone (${Math.round(box.height)}px)`);
  });
}
await run("7-mobile-setup", { width: 390, height: 844 }, loadSeeds);
await run("8-mobile-result", { width: 390, height: 844 }, toResult);

await browser.close();
console.log(errors.length ? `Browser errors:\n${errors.join("\n")}` : "No browser errors");
if (errors.some((e) => !/net::ERR|Failed to load resource/.test(e))) process.exit(1);
