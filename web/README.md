# Hundredfoldz

**Five cards in. A hundred out.** Hundredfoldz is a web app that builds a complete Commander deck from five seed cards, in the bracket you choose (1–4). It can also complete a deck you started or suggest upgrades for one you finished. You pick the cards (one of them can be the commander), and Claude builds the deck live using the [mtg-master skill](../mtg-master): it researches on Scryfall, writes the list, and keeps fixing it until the server-side deck check passes.

Next.js (App Router), React 19, plain CSS. No SDK dependencies beyond Next and React, and no database required: an optional Upstash Redis store adds short share links and lets builds survive switching servers.

## What you get

- **The setup:** a fanned hand of five seed cards with Scryfall autocomplete and a "Surprise me" button. You can crown a legendary creature as commander or let Claude choose. There's a bracket picker (1–4), budget options, a free-text wish list, and the page tints itself to your color identity.
- **Deck shape (optional):** minimum and maximum creatures, lands, ramp, card draw, removal and board wipes, and a cap on the average mana value. Claude gets them as targets; the server counts them from the card text (creatures from the type line) and sends the deck back when one is off, for the first three tries; after that a miss is a warning. The deck's sidebar shows each limit against the real count. They replace the template's own checks for the counts you set, and apply to completing and upgrading a deck too.
- **Start from your own deck:** paste or upload a decklist. If it has fewer than 100 cards, Hundredfoldz asks whether to complete it: every card you have stays and Claude fills the rest. If it's complete, it offers upgrades: Claude keeps the commander and the plan and suggests up to 10 swaps, each with a reason. The result lists the swaps above the deck and marks the new cards.
- **The live build:** Claude's notes stream in while it works, and every Scryfall search is shown with its exact query. "The Hundred", a 10×10 grid of sleeves, fills up card by card in each card's role color while Claude writes the list. The build keeps running if you switch apps or lose the connection; the page reconnects and picks up where it left off (see [Builds that survive leaving the page](#builds-that-survive-leaving-the-page)).
- **The deck:**
  - a commander banner, strategy and win conditions, and the Bracket 3 checklist
  - cards grouped by role, with images and a click-through detail view that explains why each card is in the deck
  - a type list, a mana curve, counts against the Commander template, color demand and a price in EUR
  - opening hands: thousands of goldfished games show how often you keep your first 7, hit your third and fourth land on time, have each color by turn 3 and cast the commander on time (see [Opening-hand check](#opening-hand-check))
  - a sample-hand drawer
  - copy for Moxfield/Archidekt or Arena, and a .txt download
- **Own key:** visitors build with their own Claude API key and model, and see the tokens and estimated cost of each build. The key field works with password managers.
- **Your collection:** prefer cards you own, or build only from them.
- **Bracket checker:** paste or upload any decklist at `/bracket` to see which bracket it fits and why, with the opening-hand numbers.
- **Box EV:** what every booster box since 2020 is worth on average at `/ev`, after selling costs, with your chance to get your price back (see [Box EV](#box-ev)). The deck view adds "Singles or boxes?": which boxes could give you the deck's cards, and what those cards cost as singles.
- **Buy the cards:** every deck can open TCGplayer or Card Kingdom with the whole list in the cart, or copy it for a Cardmarket wants list. Clicking a card shows its price at Cardmarket, TCGplayer and Card Kingdom (cheapest printing), each with a buy link. Box EV pages link to each shop's search for the box. Affiliate tags are optional settings (see the environment variables); tagged links are marked `sponsored` and the page says so.
- **Navbar:** Build a deck, Bracket checker, Box EV and My decks on every page, with GitHub and Support links; a menu button on phones.
- **Saving:** "My decks" keeps your finished decks in the browser. With accounts switched on (see [Accounts](#accounts-optional)), logging in with an email link, Discord or Google keeps them in your account instead, on every device, with rename and delete; decks already in the browser can be moved over.
- **Sharing:**
  - the "Share deck" sheet: native sharing on phones, WhatsApp, Reddit (as a link, or a ready-made Markdown post with the decklist), Telegram, X and email
  - "Open in Moxfield/Archidekt", which copies the list and opens their importer
  - shared links open a read-only deck page with fresh card data and the bracket check, and get a preview image (commander art, deck name) in WhatsApp, Reddit and Discord
  - with a store connected (see [Short share links](#short-share-links)), links are short: `/d/x7Kp2QaZ1`. Without one, the whole deck is compressed into the link (`/deck?d=…`, about 1.8 KB), so sharing works with no database at all
  - links always point at your public domain, never at a deployment URL that sits behind Vercel's login

## Bracket checker

`/bracket` is a free tool: paste any Commander decklist (Moxfield, Archidekt, Arena, MTGO or plain "1 Card" lines) and it shows the lowest bracket the deck fits, the cards that decide it, and a legality check. It needs no Claude and no API key: Game Changer flags and card text come from Scryfall, combos from Commander Spellbook, and the rules are in `lib/server/bracket-check.ts` (checked against Wizards' brackets on 2026-10-25). Brackets 1 and 5 depend on intent, so the result says when a deck could also be one of those.

## Accounts (optional)

Logging in is optional: everything works without an account. An account keeps your decks on every device. Accounts use [Supabase](https://supabase.com) (Auth and Postgres) through its REST APIs, with no SDK.

- **Sessions** are httpOnly cookies set by the app's own routes (`/api/auth/*`, `/auth/callback`). Page scripts never see a token, so the security policy stays `connect-src 'self'`.
- **Logins** are PKCE: email magic links, and Discord or Google if you switch them on. A magic link must be opened in the browser that asked for it.
- **Row-level security** in the database decides who sees what: each user reads, saves and deletes only their own decks, and only a deck's name can change after saving. `supabase/migrations/` has the schema; `.github/workflows/accounts.yml` runs it on a local Supabase and checks this with two real users (`scripts/check-supabase.mjs`).
- **Deleting the account** on the account page removes the user and every deck in it, right away (a database function that can only delete the caller).
- A saved deck is the same compressed payload as a share link. The server decodes it to fill in the name and commander, so the browser can't save something that isn't a deck. The same deck saved twice is one row, and an account keeps up to 1,000.

To switch it on for your copy:

1. Create a Supabase project, in an EU region if your users are in Europe.
2. Run `web/supabase/migrations/20261026000000_accounts.sql` once: paste it into the SQL editor, or `supabase link` and `supabase db push`.
3. In **Authentication → URL configuration**, set the Site URL to your domain and add `https://your-domain/auth/callback` (and `http://localhost:3000/auth/callback` for local development) to the redirect URLs.
4. **Email:** Supabase's built-in email is meant for testing and sends only a few emails an hour. Before you launch, add your own SMTP server (Resend, Postmark, Brevo and others) under **Authentication → Emails**.
5. **Discord or Google (optional):** create an OAuth app with the provider, using `https://<project>.supabase.co/auth/v1/callback` as its redirect URL, and enter its client id and secret under **Authentication → Providers**. The login dialog shows the providers that are switched on.
6. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or the newer publishable key as `SUPABASE_PUBLISHABLE_KEY`) in Vercel. No secret or service-role key is needed.

Without these settings the app works as before: no login button, decks in the browser.

## Box EV

`/ev` lists every Play, Collector, Set and Draft Booster box released since 2020 with its average card value. A box's page (`/ev/dsk-play`) lets you enter what you'd pay and shows:

- **Average card value:** every card at its Cardmarket trend price, weighted by how often it's in a pack.
- **After selling:** a 5% marketplace fee, and cards under €1 count as €0 because they aren't worth listing one by one. Both, plus a sell-below-trend discount and the pack count, can be changed.
- **Your chance to get your price back:** from 4,000 simulated boxes (seeded, so the same box gives the same answer), with the spread and the middle box, because a few big pulls lift the average above what most boxes give.
- **The cards that carry the value:** price, copies per box and share of the EV.

The data is built once a day by `.github/workflows/ev-data.yml` (`scripts/build-ev.mjs`). It needs no secrets:

- pack layouts and slot odds come from [taw/magic-sealed-data](https://github.com/taw/magic-sealed-data), the source of MTGJSON's booster data;
- prices come from Scryfall (Cardmarket trend, EUR), looked up by set and collector number;
- the result goes to the `ev-data` branch as one commit (no history, so the repo stays small), and Vercel doesn't deploy that branch.

The site reads it from GitHub and keeps it in memory for 30 minutes. A self-hosted copy reads the same data, or set `EV_DATA_URL` to your own. Sealed box prices aren't in any free data source, which is why you enter your own price. Packs per box come from MTGJSON's sealed products (Final Fantasy Play boxes have 30, Commander Masters Collector boxes 4); box toppers aren't counted, so boxes with one are worth a little more than shown.

## Opening-hand check

`lib/shared/openers.ts` goldfishes a deck a few thousand times, with a seeded shuffle so a deck always gets the same numbers. It needs no API calls and runs in the browser for the deck view, and on the server for the bracket checker, the engine's review round and the eval. Each simulated game:

- takes Commander mulligans: the first is free, later ones put a card on the bottom. It keeps 3–5 lands, or 2 lands with cheap ramp or two cheap spells;
- draws every turn, turn 1 included, because nobody skips the first draw in multiplayer;
- plays a land each turn, an untapped one that adds a missing color first;
- casts the commander as soon as the mana and colors allow, and cheap ramp otherwise. Rocks work right away; mana creatures and land-search spells work from the next turn.

It reports the keep rate, lands in the first 7, the third land on turn 3 and the fourth on turn 4, flooding, each color by turn 3, and the commander on curve and one turn later. It's an estimate of the mana, not of how the deck plays. CI prints the numbers for the sample decks in `evals/sample-decks/` (`scripts/check-openers.mjs`).

## How it uses the skill

`scripts/sync-skill.mjs` compiles `../mtg-master/SKILL.md` and the relevant reference sections (`commander.md`, the Karsten table in `constructed.md`, the search syntax in `lookup.md`, and the Commander rules in `rules.md`) into `lib/skill/content.ts`. That becomes Claude's system prompt, plus a short adapter (`lib/server/prompt.ts`).

The adapter maps the skill's scripts to tools the server implements, because Claude has no shell here:

| Skill script | App tool | Implemented in |
|---|---|---|
| `scripts/scryfall.py search` | `search_cards` | `lib/server/scryfall.ts` |
| `scripts/scryfall.py cards` | `get_cards` | `lib/server/scryfall.ts` |
| `scripts/deckcheck.py --format commander` | `submit_deck`, validated server-side | `lib/server/validate.ts` |

`submit_deck` checks that the deck has exactly 100 cards, that it's singleton (with exceptions such as Relentless Rats and basic lands), Commander legality, color identity, the commander and any partner/Background pairing, that all five seeds are in the deck, and that there are at most 3 Game Changers. It also warns about mass land denial and extra turns. Errors go back to Claude until the deck passes (at most 4 attempts). The Game Changers list is read live from Scryfall, so it stays current.

After editing the skill, run `npm run sync-skill` and commit `lib/skill/content.ts`. CI fails if the two are out of sync.

## Host your own

Hundredfoldz is free and open source, and a copy needs no API key of its own: visitors build with their own Claude API key (see [Own API keys](#own-api-keys)). You can also give your copy a server key behind an access code, for yourself and your friends.

### Option 1: Deploy to Vercel (easiest)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FM-Sahin%2Fmtg-master&root-directory=web)

The button copies this repository to your GitHub account and sets the root directory to `web`. No environment variables are required: the site starts with own-key builds and the demo. Vercel's free Hobby plan is enough.

Prefer to do it by hand? In Vercel, choose **Add New → Project**, import your copy of the repository, set **Root Directory** to `web`, add the variables below, and deploy.

### Option 2: Docker (any server, a NAS or a Raspberry Pi)

```bash
git clone https://github.com/M-Sahin/mtg-master.git
cd mtg-master/web
cp .env.example .env.local      # optional: a server key (ANTHROPIC_API_KEY + ACCESS_CODE), Upstash, DONATION_URL
docker compose up -d            # http://localhost:3000
```

Or without compose (here with a server key; leave both variables out to run on visitors' own keys):

```bash
docker build -t hundredfoldz .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... -e ACCESS_CODE=choose-one hundredfoldz
```

Put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) if other people will use it. The proxy must not buffer responses, so the live build view keeps streaming; Caddy and Traefik don't buffer by default.

### Option 3: Node.js

```bash
cd web && npm ci && npm run build && npm start
```

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | no | A server key for builds without a visitor key, created at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Without it, builds run on visitors' own keys, and without a key at all the app replays one scripted demo deck. |
| `ACCESS_CODE` | yes, with a server key | Visitors have to enter this code to build on the server key. Without it, anyone who has the URL spends your credits, so server-key builds are refused until you set it. Own-key builds don't need it. |
| `OWN_KEYS` | no | Visitors' own Claude API keys. Without a server key they're allowed unless you set `0`. With a server key they're off unless you set `1`, so a deployment behind an access code doesn't open up when it updates. |
| `OWN_KEY_BUILDS_PER_HOUR` | no | Builds per own key per hour (default 20), to protect Scryfall and the server. |
| `DONATION_URL` | no | An `https://` link (Ko-fi, GitHub Sponsors…) shown in the footer and under each finished deck, e.g. `https://ko-fi.com/yourname`. |
| `PUBLIC_ACCESS` | no | Set it to `1` only if you really want builds open to everyone without a code. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. `claude-opus-5-5` gives stronger decks but is slower and costs more. |
| `AFFILIATE_TCGPLAYER`, `AFFILIATE_CARDKINGDOM`, `AFFILIATE_CARDMARKET` | no | Affiliate tags for the "Buy the cards" and "Find this box" links: a link template with `{url}` where the shop link goes (what Impact gives you for TCGplayer, e.g. `https://tcgplayer.pxf.io/c/…?u={url}`), or parameters to add to the shop link (`partner=yourname`). Without them the links work, untagged. When any is set, the page says some links are affiliate links. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no | Accounts and decks saved to them (see [Accounts](#accounts-optional)). `SUPABASE_PUBLISHABLE_KEY` and the `NEXT_PUBLIC_` names the Supabase Vercel integration sets work too. |
| `EV_DATA_URL` | no | Where the Box EV data is read from. Defaults to this repo's `ev-data` branch on GitHub. |
| `BUILDS_PER_HOUR_PER_IP` | no | A best-effort limit per IP, kept per server instance (default 6). |
| `DEMO_MODE` | no | Set it to `1` to force demo mode even when a key is set. Only the value `1` switches it on. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | no | Turn on short share links. Set automatically when you connect Upstash for Redis on Vercel (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too). |
| `SITE_URL` | no | The public address used in share links, e.g. `https://decks.example.com`. On Vercel the default is your production domain. |
| `ENGINE` | no | The deckbuilding engine: `v1` (default) or `v2`. See [Engine quality and evals](#engine-quality-and-evals). |

On Vercel, store `ANTHROPIC_API_KEY` and `ACCESS_CODE` as the **Secret** type. Redeploy after changing a variable, because changes only apply to new deployments.

### Own API keys

On the setup screen, visitors can paste their own Claude API key. The page walks them through making one: a Claude Console workspace with a monthly spend limit, a little credit, and a key from that workspace.

- **The key stays in the browser.** It's kept in this device's storage, or for the tab only if the visitor prefers. It's sent with each build in a header, used only for that build, and never written to logs, the job store or share links. A strict Content Security Policy (`proxy.ts`, a fresh nonce per request) stops injected scripts from reading it.
- **Password managers.** The key field is a login-style form (a hidden "Claude API key" username and a password field), so Chrome, Safari, 1Password and Bitwarden offer to save the key and fill it in later, also after clearing the cache and on other devices. The setup steps tell people to save it right away, because the Console shows a key only once, and how to replace a lost one.
- **The key is checked first** with Anthropic's model list (`/api/key/check`), which also fills the model picker. The result is cached per tab, so reloading doesn't re-check.
- **Model choice.** The picker offers Sonnet 5.5 (default), Opus 5.5 and Haiku 5.5, plus every other model the key can use under "Show all".
- **Cost.** The live build and the finished deck show the tokens used and an estimated cost (prices in `lib/shared/models.ts`).
- **Clear errors.** "Out of credit", "spend limit reached", "key not accepted", "model not available" and "rate limited" each say what to do.
- **Limits.** Builds are limited per key (`OWN_KEY_BUILDS_PER_HOUR`, default 20) and key checks per IP and key, so people behind one shared address don't block each other.

### Build from your collection

Visitors can load their collection: a CSV export (Moxfield, Archidekt, ManaBox, Deckbox, Dragon Shield and others with a Name column) or a plain list, up to 5,000 different cards. "Prefer my cards" marks owned cards in Claude's search results and asks it to use them. "Only my cards" also has the server reject unowned cards (seeds and basic lands are always allowed). The collection stays in the browser and is sent with the build.

### My decks

Finished decks are kept in the browser (up to 30) as compact share payloads, and reopen with fresh card data.

### Short share links

Shared decks are stored for a year (renewed whenever someone opens the link) in Upstash Redis, which has a free tier. On Vercel: **Storage → Create Database → Upstash for Redis** (or the Marketplace), connect it to this project, and redeploy. The integration adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. Elsewhere, create a free database at upstash.com and set those two variables yourself. The same deck always gets the same link, and links fall back to the long form if the store is unreachable.

### Builds that survive leaving the page

Phones pause or drop connections when you switch apps, so a build doesn't depend on the browser's connection:

- `POST /api/generate` starts the build as a job (kept running with Next's `after()`) and streams its events, each with an index. A heartbeat every 5 seconds lets the page tell a quiet connection from a dead one.
- When the stream drops, or the page comes back after more than a moment in the background, the page reconnects with `GET /api/generate?job=<id>&from=<n>` and continues from the last event it saw. A reload mid-build picks the build up again from `sessionStorage`.
- "Stop building" calls `POST /api/generate/stop`; closing the connection no longer stops a build.
- Events are kept in memory, which is enough for Docker and Node. On Vercel a reconnect can reach a different server instance, so with Upstash connected the events are also batched into Redis (about 150–200 commands per build) and any instance can serve the reconnect.

**Why did a shared link ask for a Vercel login?** Vercel's default Deployment Protection puts a login in front of deployment URLs (`yourproject-abc123-you.vercel.app`, the "Visit" button in the dashboard). Only the production domain is public. Share links now always use the production domain (or `SITE_URL`), so this can't happen anymore.

**Cost:** each build is one Claude conversation of about 4–8 turns, paid from your own API account. The skill prompt and the growing conversation are prompt-cached. Set a monthly spend limit in the Claude Console (Billing → Spend limits) as an extra guard.

**Function duration:** a build usually takes 1–3 minutes. On Vercel, `app/api/generate/route.ts` sets `maxDuration = 300`, which is the Hobby maximum on Fluid compute. The agent submits by about 3½ minutes and stops at about 4½ minutes with the best deck it has (it keeps 25 seconds after each Claude call to check the deck), so it finishes inside the limit. On Pro you can raise `maxDuration` (the maximum is 800). Docker and Node.js have no such limit.

**Keeping your copy up to date:** use **Sync fork** on GitHub (or `git pull` for Docker). Vercel redeploys automatically when your copy changes.

## Engine quality and evals

The engine has two versions. Every change in `v2` is behind its own switch, so it can be measured against `v1` before it becomes the default.

| Switch | What it does | Why it should give better decks |
|---|---|---|
| `prompt2` | Claude plans the 99 slots before searching, spends its searches on the seeds' theme and on recent cards, and skips searches for staples it already knows | Its memory is weakest on synergy pieces and new cards, which is where the deck's identity comes from |
| `fullText` | Search results carry the full Oracle text instead of a 140-character excerpt | Less guessing from memory, fewer misread cards |
| `strict` | The server counts lands, ramp, draw, removal and colored sources from the card text itself (`lib/shared/analysis.ts`). Big gaps are errors on the first two submits | Claude no longer grades its own role tags |
| `review` | After the first legal deck, Claude gets the server's analysis and opening-hand numbers and makes up to 10 swaps with a cheap `revise_deck` tool | Critiquing a concrete list with hard numbers is easier than getting 99 cards right in one pass |
| `manabase` | The server re-splits the basic lands across colors by colored-source targets and mana symbols | Counting pips over 99 cards is arithmetic, which code does better |
| `combos` | [Commander Spellbook](https://commanderspellbook.com) checks the deck; two-card combos it rates Ruthless are errors (unless both pieces are the user's own picks); Spicy ones are flagged | A cheap two-card combo makes it the wrong deck for a Bracket 3 table |
| `effort` | `ENGINE=v2,effort=xhigh` sets the API's effort level (default: the model's own) | More thinking per turn, at the cost of time |

Thinking is already on: the 5.5 models use adaptive thinking by default.

Specs combine a preset with switches: `v2`, `v2-review`, `v1+strict+fullText`, `v2,effort=xhigh`.

### Running an eval

`evals/hands.json` has 20 seed hands: every color count, tribal and non-tribal, chosen and open commanders, a partner pair, double-faced seeds and all three budgets. The harness builds each hand with each variant and scores every deck:

- whether it's legal, time, token cost, and searches and submits per build;
- objective numbers from the analysis: template roles in range, missing template cards, colored sources short of the Karsten targets, share of generic top-300 EDHREC staples, price against the budget, and too-strong combos;
- opening hands: the fourth land on turn 4, the commander on time, and the worst color by turn 3;
- a blind A/B judgement: Opus compares each variant's deck with the baseline's on the same hand, twice with the order swapped, and a win only counts when both orders agree.

```bash
node scripts/eval.mjs check                          # hands resolve on Scryfall, combo service works (no key)
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval.mjs run --variants v1,v2 --hands 6 --judge claude-opus-5-5
```

A variant can name its own builder model with `@`: `--variants v2,v2@haiku` compares Sonnet with Haiku on the same engine. `--max-usd` caps the estimated spend (the GitHub workflow defaults to $3.50 and three hands).

Results so far (three hands each, so treat them as hints):

| Run | Result |
|---|---|
| v1 against v2, Sonnet | v2 won 2, lost 0, tied 1. Fewer generic staples (32% against 39%), and the review cut too-strong combos. About $0.23 a deck against $0.19. Its Esper mana was skewed (12 Island, 4 Plains), which led to the fix in the basic-land split. |
| v2 on Sonnet against v2 on Haiku | Every deck legal. Haiku costs about $0.017 a deck against $0.25, but lost 1 and tied 2, with weaker synergy and mana scores. Sonnet stays the default; Haiku is the budget option. |

The output folder (`evals/out/<time>/`) holds `report.md`, `results.json` and every decklist with its analysis, so you can read the decks yourself too.

In GitHub, add the repository secret `ANTHROPIC_API_KEY` (preferably from a Console workspace with a spend limit), then run **Actions → eval → Run workflow**. The report appears in the run summary and on the `ci-output` branch under `evals/`.

## Develop

```bash
cd web
npm install
cp .env.example .env.local   # optional: leave it empty and paste your own key in the page, or watch the demo
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests (Node's test runner, bundled with esbuild): validation and partner rules, the SSE parser, the agent loop with scripted "Claude" turns, engine variants and the review pass, complete and upgrade modes, accounts and saved decks against a fake Supabase, the deck analysis on real Oracle text, the opening-hand simulator, combos, own keys, collections, jobs and reconnects, share links, the bracket checker and the eval harness |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `node scripts/e2e-demo.mjs` | End-to-end check against a running server in demo mode (uses real Scryfall) |
| `node scripts/screenshots.mjs` | Screenshots of every screen (needs `playwright`) |
| `node scripts/check-scryfall-live.mjs` | Checks double-faced, split and accented card names, and partner pairings, against the live Scryfall API |
| `node scripts/calibrate-analysis.mjs` | Compares the role detector with Scryfall Tagger on the most-played cards per role (needs Scryfall access) |
| `node scripts/eval.mjs check` / `run` | The engine eval (see [Running an eval](#running-an-eval)) |
| `node scripts/build-ev.mjs --out ev-out [--only dsk-play]` | Builds the Box EV data (needs GitHub and Scryfall) |
| `node scripts/check-openers.mjs [list.txt …]` | Opening-hand numbers for real decklists, before and after the basic-land rebalance (needs Scryfall) |

CI (`.github/workflows/web.yml`) runs all of these on every push except the eval run, and also builds and tests the Docker image. The browser pass checks the share flow, link previews, a cut-off build stream, switching apps, the key form, the security policy, the bracket checker, the Opening hands panel, completing and upgrading a deck, and the phone header. A step also prints the opening-hand numbers for the sample decks. CI publishes the screenshots, logs and the lockfile it resolved to the `ci-output` branch. The eval has its own manual workflow (`.github/workflows/eval.yml`).

### Layout

```
app/                    pages: / (builder), /bracket, /deck?d= and /d/<id> (shared decks); layout, CSS
app/api/                generate (+ reconnect, stop), key/check, bracket, share, deck/resolve, og, config, cards/*
proxy.ts                Content Security Policy with a per-request nonce
components/             App (flow and state), SeedHand, CardSearch, ForgeView (live build), DeckView, CardFace,
                        KeyPanel, CollectionPanel, MyDecks, ShareSheet, SharedDeck, BracketChecker
lib/server/             agent loop, engine variants, Claude client, Scryfall client, validation, combo check,
                        prompt, jobs (reconnectable builds), store (Upstash), share links, bracket check, demo
lib/shared/             types, bracket rules, deck analysis, models and prices, collection and decklist parsers,
                        share payloads, deck statistics and export
lib/client/             browser API: builds with reconnect, key storage, My decks
lib/skill/content.ts    generated from ../mtg-master
evals/                  eval hands, runner, scorecard, blind judge, report
scripts/                sync-skill, test runner, e2e, screenshots, live Scryfall checks, calibration, eval
tests/                  unit tests and Scryfall fixtures
```

## Notes

- Bracket 3 rules for the builder were checked on 2026-10-24 against Wizards' Commander format page and the Commander Brackets updates of October 2025 and February 2026. They're in `lib/shared/bracket.ts`. The bracket checker's rules for all brackets were checked on 2026-10-25 and are in `lib/server/bracket-check.ts`. Update both when Wizards changes the brackets.
- Model prices for the cost estimate were checked on 2026-10-25 and are in `lib/shared/models.ts`.
- Prices are Scryfall's Cardmarket (EUR) trend prices and change daily.
- Hundredfoldz is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images come from [Scryfall](https://scryfall.com) and follow its [API rules](https://scryfall.com/docs/api): it's free to use, with no paywall, and artists are credited.
