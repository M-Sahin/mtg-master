#!/usr/bin/env node
// Renders the images the login emails use (public/email/*.png: email clients don't show SVG or
// load the site's CSS) and, with --preview <dir>, screenshots of the email templates in
// supabase/templates/ as they'll look in a mail client.
//   node scripts/render-email.mjs [--preview shots]
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// require() also finds a globally installed Playwright (CI images and this repo's dev setups)
const { chromium } = createRequire(import.meta.url)("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "email");
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const preview = args.includes("--preview") ? args[args.indexOf("--preview") + 1] : null;

const MARK = `<svg width="26" height="26" viewBox="0 0 32 32"><rect x="5" y="4" width="16" height="22" rx="2.5" fill="none" stroke="#e2b04a" stroke-width="1.8" transform="rotate(-10 13 15)"/><rect x="11" y="6" width="16" height="22" rx="2.5" fill="#e2b04a" opacity=".9" transform="rotate(8 19 17)"/></svg>`;

const sleeve = `border-radius:9px;background:repeating-linear-gradient(45deg,rgba(255,255,255,.04) 0 5px,transparent 5px 10px),linear-gradient(160deg,#2c3567,#1d2449);border:1px solid rgba(190,198,255,.3);box-shadow:0 10px 22px rgba(0,0,0,.45);`;

// five sleeves fanned around the bottom centre; the middle one carries the mark
const FAN_W = 560;
const FAN_H = 236;
const FAN = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="fan" style="position:relative;width:${FAN_W}px;height:${FAN_H}px">
  ${[0, 1, 2, 3, 4]
    .map((i) => {
      const off = i - 2;
      const mid = off === 0;
      const w = mid ? 118 : 104;
      const h = mid ? 166 : 146;
      const left = FAN_W / 2 + off * 74 - w / 2;
      const top = 30 + Math.abs(off) * 14 + (mid ? -8 : 0);
      return `<div style="position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;transform:rotate(${off * 9}deg);transform-origin:50% 100%;z-index:${mid ? 5 : 3 - Math.abs(off)};${sleeve}${mid ? "border:2px solid #e2b04a;background:linear-gradient(160deg,#323d78,#1d2449);" : ""}">
        ${mid ? `<div style="position:absolute;inset:0;display:grid;place-items:center">${MARK.replace('width="26" height="26"', 'width="60" height="60"')}</div>` : ""}
      </div>`;
    })
    .join("")}
</div></body></html>`;

const MARKPAGE = `<!doctype html><html><body style="margin:0;background:transparent"><div id="mark" style="width:28px;height:28px;display:grid;place-items:center">${MARK}</div></body></html>`;

const browser = await chromium.launch();
const shot = async (html, selector, file, scale = 2) => {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 700, height: 400 } });
  await page.setContent(html);
  await page.locator(selector).screenshot({ path: file, omitBackground: true });
  await page.close();
};
await shot(FAN, "#fan", join(out, "fan.png"));
await shot(MARKPAGE, "#mark", join(out, "mark.png"), 4);
console.log(`wrote ${join(out, "fan.png")} and mark.png`);

if (preview) {
  mkdirSync(preview, { recursive: true });
  const dir = join(root, "supabase", "templates");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    // fill in Supabase's template variables, and serve the images from this checkout
    const html = readFileSync(join(dir, f), "utf8")
      .replaceAll("{{ .ConfirmationURL }}", "https://hundredfoldz.app/auth/callback?code=example")
      .replaceAll("{{ .Email }}", "player@example.com")
      .replaceAll("{{ .SiteURL }}", "https://hundredfoldz.app")
      .replaceAll("https://hundredfoldz.app/email/", `file://${out}/`);
    for (const [name, vp] of [["desktop", { width: 760, height: 900 }], ["phone", { width: 390, height: 900 }]]) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
      await page.goto(`file://${join(dir, f)}`); // a file:// origin so file:// images load
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(preview, `${f.replace(".html", "")}-${name}.png`), fullPage: true });
      await page.close();
    }
  }
  console.log(`previews in ${preview}`);
}
await browser.close();
