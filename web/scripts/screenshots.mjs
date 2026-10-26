#!/usr/bin/env node
// Captures the main screens in demo mode (used in CI; needs `playwright` installed).
//   BASE_URL=http://localhost:3000 OUT=shots node scripts/screenshots.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  await p.waitForSelector("[data-testid=openers] .op-row", { timeout: 10000 }).catch(() => errors.push("no Opening hands panel on the Numbers tab"));
  const rows = await p.locator("[data-testid=openers] .op-row").allInnerTexts();
  console.log(`opening hands: ${rows.map((r) => r.replace(/\s+/g, " ")).join(" | ")}`);
  await p.waitForSelector("[data-testid=deck-boxes] .deckboxes-list", { timeout: 20000 }).catch(() => {});
  const boxes = await p.locator("[data-testid=deck-boxes]").innerText({ timeout: 2000 }).catch(() => "(no panel: none of the deck's cards are in a box since 2020)");
  console.log(`singles or boxes: ${boxes.replace(/\s+/g, " ").slice(0, 400)}`);
  await p.locator("[data-testid=openers]").scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(500);
});
// "Buy the cards": a shop link with the deck in its cart
await run("27-buy-cards", { width: 1440, height: 1000 }, async (p) => {
  await toResult(p);
  await p.click("[data-testid=buy-toggle]");
  const shops = await p.locator("[data-testid=buy-links] .buy-shop").allInnerTexts();
  const tcg = await p.locator("[data-testid=buy-links] a.buy-shop", { hasText: "TCGplayer" }).getAttribute("href").catch(() => "");
  const cart = tcg ? new URL(tcg).searchParams.get("c") ?? "" : "";
  console.log(`buy the cards: ${shops.map((s) => s.replace(/\s+/g, " ")).join(" | ")}; TCGplayer cart has ${cart.split("||").filter(Boolean).length} cards`);
  if (shops.length !== 3 || cart.split("||").length < 60) errors.push(`buy links look wrong: ${shops.join(", ")}; ${cart.slice(0, 80)}`);
});
// a card's price at each shop, with buy links
await run("28-card-offers", { width: 1440, height: 1000 }, async (p) => {
  await toResult(p);
  await p.locator(".role-grid .tile").nth(1).locator("button, [role=button], img").first().click();
  await p.waitForSelector("[data-testid=card-offers] .offer", { timeout: 20000 }).catch(() => errors.push("no shop prices in the card view"));
  const rows = await p.locator("[data-testid=card-offers] .offer").allInnerTexts();
  console.log(`card offers: ${rows.map((r) => r.replace(/\s+/g, " ")).join(" | ")}`);
  if (rows.length !== 3) errors.push(`card view shows ${rows.length} shops`);
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
// start from your own deck: an incomplete list gets the "complete it?" question
await run("20-complete-my-deck", { width: 1440, height: 1000 }, async (p) => {
  const picker = await p.locator("input[name=bracket]").count();
  if (picker !== 4) errors.push(`bracket picker has ${picker} options`);
  await p.click("text=Add my deck");
  await p.fill("[data-testid=deck-list]", "Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n1 Sakura-Tribe Elder\n1 Viscera Seer\n1 Eternal Witness\n10 Forest\n10 Swamp");
  await p.click("text=Read my deck");
  await p.waitForSelector("[data-testid=deck-start-result]", { timeout: 60000 });
  const ask = await p.locator(".deckstart-ask").innerText().catch(() => "");
  console.log(`complete my deck: ${ask.split("\n")[0]}`);
  if (!/Your deck has 25 cards\. Do you want Hundredfoldz to complete it\?/.test(ask)) errors.push(`no completion question: ${ask}`);
  // this demo deployment has no key: the button explains why it's off
  if (!(await p.locator("text=Yes, complete my deck").isDisabled())) errors.push("complete button should need an API key here");
});
// bracket checker: upload a .txt decklist
await run("21-bracket-upload", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}/bracket`, { waitUntil: "networkidle" });
  await p.setInputFiles("[data-testid=bracket-file]", { name: "deck.txt", mimeType: "text/plain", buffer: Buffer.from("Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n1 Demonic Tutor\n") });
  await p.waitForFunction(() => document.querySelector("[data-testid=bracket-list]")?.value.includes("Demonic Tutor"), null, { timeout: 5000 });
  await p.click("text=Check the bracket");
  await p.waitForSelector(".bracket-badge", { timeout: 60000 });
  console.log(`bracket upload: ${await p.locator(".bracket-badge strong").innerText()}`);
});
// upgrade a finished deck: the question, the request, the swaps panel and "New" marks.
// CI has no real key, so the key check and the build stream are canned in the browser.
await run("22-upgrade-my-deck", { width: 1440, height: 1000 }, async (p) => {
  let sent = null;
  await p.route("**/api/key/check", (r) => r.fulfill({ json: { models: [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }] } }));
  await p.route("**/api/generate", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    sent = r.request().postDataJSON();
    const keep = sent.seeds.slice(1).map((name) => ({ name, role: "synergy", why: "In your deck", qty: 1 }));
    const basics = Object.entries(sent.basics ?? {}).map(([name, qty]) => ({ name, role: "land", why: "", qty }));
    const deck = {
      name: `${sent.commander}, upgraded`, strategy: "The user's deck.", winConditions: [], bracketNotes: "", colorIdentity: ["B", "R"], bracket: sent.bracket,
      commander: { name: sent.commander, role: "wincon", why: "", qty: 1 },
      cards: [{ name: "Night's Whisper", role: "draw", why: "Cheap card draw", qty: 1 }, ...keep, ...basics],
    };
    const swaps = [{ out: sent.seeds[0], in: "Night's Whisper", role: "draw", why: "Cheap card draw for the sacrifice plan" }];
    const lines = [{ type: "status", text: "Claude is looking for upgrades" }, { type: "deck", deck, validation: { ok: true, errors: [], warnings: [], total: 100, gameChangers: [] }, swaps }, { type: "done", ms: 5 }];
    await r.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
  });
  await p.fill("[data-testid=api-key]", "sk-ant-api03-" + "y".repeat(60));
  await p.press("[data-testid=api-key]", "Enter");
  await p.waitForSelector(".keypanel .pill--ok", { timeout: 20000 });
  await p.click("text=Add my deck");
  await p.fill("[data-testid=deck-list]", readFileSync("evals/sample-decks/judith-aristocrats--v2--1.txt", "utf8"));
  await p.click("text=Read my deck");
  await p.waitForSelector("[data-testid=deck-start-result]", { timeout: 60000 });
  const ask = await p.locator(".deckstart-ask").innerText().catch(() => "");
  console.log(`upgrade my deck: ${ask.split("\n")[0]}`);
  if (!/Your deck is complete\. Do you want Hundredfoldz to suggest upgrades\?/.test(ask)) errors.push(`no upgrade question: ${ask}`);
  await p.click("[data-testid=upgrade-deck]");
  await p.waitForSelector("[data-testid=upgrade-summary]", { timeout: 30000 }).catch(() => errors.push("no upgrade summary after the build"));
  const swaps = await p.locator(".swap").allInnerTexts();
  const marked = await p.locator(".tile-new").count();
  console.log(`upgrade request: mode ${sent?.mode}, ${sent?.seeds?.length} cards, commander ${sent?.commander}, basics ${JSON.stringify(sent?.basics)}; swaps shown: ${swaps.map((s) => s.replace(/\s+/g, " ")).join(" | ")}; ${marked} card(s) marked New`);
  if (sent?.mode !== "upgrade" || !/Judith/.test(sent?.commander ?? "")) errors.push(`upgrade request looked wrong: ${JSON.stringify(sent)?.slice(0, 200)}`);
  if (swaps.length !== 1 || marked !== 1) errors.push(`upgrade view: ${swaps.length} swaps, ${marked} marked New`);
});
// Box EV: the list (real data from the ev-data branch), one box with a price, the phone layout
let evFirst = "";
await run("23-ev-index", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}/ev`, { waitUntil: "networkidle" });
  const rows = await p.locator("[data-testid=ev-table] a.ev-row").count();
  const sample = await p.locator("[data-testid=ev-table] a.ev-row").evaluateAll((els) => els.slice(0, 6).map((e) => e.innerText.replace(/\s+/g, " ")));
  console.log(`box EV list: ${rows} boxes; ${sample.join(" | ")}`);
  if (rows < 10) errors.push(`Box EV list has ${rows} boxes`);
  evFirst = (await p.locator("[data-testid=ev-table] a.ev-row").first().getAttribute("href")) ?? "";
  const active = await p.locator(".nav-main .nav-link.is-active").innerText().catch(() => "");
  if (active !== "Box EV") errors.push(`navbar active item on /ev: "${active}"`);
});
await run("24-ev-product", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}${evFirst || "/ev/dsk-play"}`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=ev-results]", { timeout: 20000 }).catch(() => errors.push("no EV results on the product page"));
  await p.fill("[data-testid=ev-price]", "100");
  await p.waitForTimeout(1200);
  const stats = await p.locator(".ev-stat").allInnerTexts();
  console.log(`box EV product ${evFirst}: ${stats.map((x) => x.replace(/\s+/g, " ")).join(" | ")}`);
  const chance = await p.locator("[data-testid=ev-chance]").innerText();
  if (!/^\d+%$/.test(chance)) errors.push(`EV chance shows "${chance}"`);
  const top = await p.locator(".ev-card").count();
  if (top < 5) errors.push(`only ${top} top cards on the EV page`);
});
await run("25-mobile-ev", { width: 390, height: 844 }, async (p) => {
  await p.goto(`${base}${evFirst || "/ev/dsk-play"}`, { waitUntil: "networkidle" });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push(`EV page scrolls sideways on a phone (${overflow}px)`);
});
// the navbar on a phone: a menu button that opens all the links
await run("26-mobile-nav", { width: 390, height: 844 }, async (p) => {
  const visible = await p.locator(".nav-main").isVisible();
  if (visible) errors.push("desktop nav links show on a phone");
  await p.click("[data-testid=nav-toggle]");
  const links = await p.locator(".nav-menu a").allInnerTexts();
  console.log(`phone menu: ${links.join(" | ")}`);
  if (!["Build a deck", "Bracket checker", "Box EV", "My decks", "GitHub"].every((l) => links.includes(l))) errors.push(`phone menu links: ${links.join(", ")}`);
});
// deck shape: a broken limit is explained and blocks the build; a good one is counted
await run("29-deck-shape", { width: 1440, height: 1000 }, async (p) => {
  await loadSeeds(p);
  await p.click("[data-testid=deck-shape] summary");
  await p.fill("[data-testid=shape-creatures-min]", "40");
  await p.fill("[data-testid=shape-creatures-max]", "20");
  const err = await p.locator("[data-testid=deck-shape] .error").innerText().catch(() => "");
  const blocked = await p.locator("text=Build my deck").isDisabled();
  console.log(`deck shape: "${err}"; build blocked: ${blocked}`);
  if (!/minimum \(40\) is above the maximum \(20\)/.test(err) || !blocked) errors.push(`deck shape check: "${err}", blocked ${blocked}`);
  await p.fill("[data-testid=shape-creatures-max]", "45");
  const pill = await p.locator("[data-testid=deck-shape] summary .pill").innerText();
  if (pill !== "1 limit") errors.push(`deck shape pill: ${pill}`);
});
// accounts (faked in the browser: CI's site has no Supabase): the login dialog, then My decks from an account
await run("30-login", { width: 1440, height: 1000 }, async (p) => {
  await p.route("**/api/auth/session", (r) => r.fulfill({ json: { enabled: true, providers: ["email", "discord"], user: null } }));
  await p.route("**/api/auth/email", (r) => r.fulfill({ json: { sent: true } }));
  await p.goto(base, { waitUntil: "networkidle" });
  await p.click("[data-testid=nav-login]");
  const discord = await p.locator(".login-modal .login-discord").getAttribute("href").catch(() => "");
  await p.fill(".login-modal [data-testid=login-email]", "player@example.com");
  await p.click(".login-modal button[type=submit]");
  const sent = await p.locator(".login-modal .login-sent").innerText({ timeout: 5000 }).catch(() => "");
  console.log(`login: discord → ${discord}; email → "${sent.slice(0, 80)}"`);
  if (!/provider=discord/.test(discord ?? "") || !/sent a login link/.test(sent)) errors.push(`login dialog: ${discord}; ${sent}`);
});
await run("31-account-decks", { width: 1440, height: 1000 }, async (p) => {
  await p.route("**/api/auth/session", (r) => r.fulfill({ json: { enabled: true, providers: ["email"], user: { id: "u1", email: "player@example.com", name: "Player", provider: "email" } } }));
  await p.route("**/api/decks", (r) =>
    r.fulfill({ json: { decks: [{ id: "00000000-0000-4000-8000-000000000001", at: Date.now(), name: "Cloud Meren", commander: "Meren of Clan Nel Toth", colors: ["B", "G"] }] } }),
  );
  await p.goto(`${base}/#my-decks`, { waitUntil: "networkidle" });
  const panel = await p.locator("[data-testid=my-decks]").innerText({ timeout: 8000 }).catch(() => "");
  const nav = await p.locator(".nav-main + .nav-side [data-testid=nav-account]").innerText().catch(() => "");
  console.log(`account decks: ${panel.replace(/\s+/g, " ").slice(0, 160)}; navbar: ${nav.replace(/\s+/g, " ")}`);
  if (!/Cloud Meren/.test(panel) || !/saved to your account/.test(panel) || !/Account/.test(nav)) errors.push(`account decks: ${panel.slice(0, 100)} / ${nav}`);
});
await run("7-mobile-setup", { width: 390, height: 844 }, loadSeeds);
await run("8-mobile-result", { width: 390, height: 844 }, toResult);

await browser.close();
console.log(errors.length ? `Browser errors:\n${errors.join("\n")}` : "No browser errors");
if (errors.some((e) => !/net::ERR|Failed to load resource/.test(e))) process.exit(1);
