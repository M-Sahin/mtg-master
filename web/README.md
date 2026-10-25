# Hundredfold

**Five cards in. A hundred out.** Hundredfold is a web app that builds a complete Bracket 3 Commander deck from five seed cards. You pick the cards (one of them can be the commander), and Claude builds the deck live using the [mtg-master skill](../mtg-master): it researches on Scryfall, writes the list, and keeps fixing it until the server-side deck check passes.

Next.js (App Router), React 19, plain CSS. No database, and no SDK dependencies beyond Next and React.

## What you get

- **The setup:** a fanned hand of five seed cards with Scryfall autocomplete and a "Surprise me" button. You can crown a legendary creature as commander or let Claude choose. There are budget options, a free-text wish list, and the page tints itself to your color identity.
- **The live build:** Claude's notes stream in while it works, and every Scryfall search is shown with its exact query. "The Hundred", a 10×10 grid of sleeves, fills up card by card in each card's role color while Claude writes the list.
- **The deck:**
  - a commander banner, strategy and win conditions, and the Bracket 3 checklist
  - cards grouped by role, with images and a click-through detail view that explains why each card is in the deck
  - a type list, a mana curve, counts against the Commander template, color demand and a price in EUR
  - a sample-hand drawer
  - copy for Moxfield/Archidekt or Arena, and a .txt download
- **Own key:** visitors build with their own Claude API key and model, and see the tokens and estimated cost of each build.
- **Your collection:** prefer cards you own, or build only from them.
- **Saving:** "My decks" keeps your finished decks in the browser.
- **Sharing:**
  - the "Share deck" sheet: native sharing on phones, WhatsApp, Reddit (as a link, or a ready-made Markdown post with the decklist), Telegram, X and email
  - "Open in Moxfield/Archidekt", which copies the list and opens their importer
  - shared links open a read-only deck page with fresh card data and the bracket check, and get a preview image (commander art, deck name) in WhatsApp, Reddit and Discord
  - with a store connected (see [Short share links](#short-share-links)), links are short: `/d/x7Kp2QaZ1`. Without one, the whole deck is compressed into the link (`/deck?d=…`, about 1.8 KB), so sharing works with no database at all
  - links always point at your public domain, never at a deployment URL that sits behind Vercel's login

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

Hundredfold is free and open source, and a copy needs no API key of its own: visitors build with their own Claude API key (see [Own API keys](#own-api-keys)). You can also give your copy a server key behind an access code, for yourself and your friends.

### Option 1: Deploy to Vercel (easiest)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FM-Sahin%2Fmtg-master&root-directory=web)

The button copies this repository to your GitHub account and sets the root directory to `web`. No environment variables are required: the site starts with own-key builds and the demo. Vercel's free Hobby plan is enough.

Prefer to do it by hand? In Vercel, choose **Add New → Project**, import your copy of the repository, set **Root Directory** to `web`, add the variables below, and deploy.

### Option 2: Docker (any server, a NAS or a Raspberry Pi)

```bash
git clone https://github.com/M-Sahin/mtg-master.git
cd mtg-master/web
cp .env.example .env.local      # fill in ANTHROPIC_API_KEY and ACCESS_CODE
docker compose up -d            # http://localhost:3000
```

Or without compose:

```bash
docker build -t hundredfold .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... -e ACCESS_CODE=choose-one hundredfold
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
| `DONATION_URL` | no | An `https://` link (Ko-fi, GitHub Sponsors…) shown in the footer and under each finished deck. |
| `PUBLIC_ACCESS` | no | Set it to `1` only if you really want builds open to everyone without a code. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. `claude-opus-5-5` gives stronger decks but is slower and costs more. |
| `BUILDS_PER_HOUR_PER_IP` | no | A best-effort limit per IP, kept per server instance (default 6). |
| `DEMO_MODE` | no | Set it to `1` to force demo mode even when a key is set. Only the value `1` switches it on. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | no | Turn on short share links. Set automatically when you connect Upstash for Redis on Vercel (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too). |
| `SITE_URL` | no | The public address used in share links, e.g. `https://decks.example.com`. On Vercel the default is your production domain. |
| `ENGINE` | no | The deckbuilding engine: `v1` (default) or `v2`. See [Engine quality and evals](#engine-quality-and-evals). |

On Vercel, store `ANTHROPIC_API_KEY` and `ACCESS_CODE` as the **Secret** type. Redeploy after changing a variable, because changes only apply to new deployments.

### Own API keys

On the setup screen, visitors can paste their own Claude API key. The page walks them through making one: a Claude Console workspace with a monthly spend limit, a little credit, and a key from that workspace.

- **The key stays in the browser.** It's kept in this device's storage, or for the tab only if the visitor prefers. It's sent with each build in a header, used only for that build, and never written to logs, the job store or share links. A strict Content Security Policy (`proxy.ts`, a fresh nonce per request) stops injected scripts from reading it.
- **Model choice.** The picker offers Sonnet 5.5 (default), Opus 5.5 and Haiku 5.5, plus every other model the key can use under "Show all".
- **Cost.** The live build and the finished deck show the tokens used and an estimated cost (prices in `lib/shared/models.ts`).
- **Clear errors.** "Out of credit", "spend limit reached", "key not accepted", "model not available" and "rate limited" each say what to do.

### Build from your collection

Visitors can load their collection: a CSV export (Moxfield, Archidekt, ManaBox, Deckbox and others with a Name column) or a plain list. "Prefer my cards" marks owned cards in Claude's search results and asks it to use them. "Only my cards" also has the server reject unowned cards (seeds and basic lands are always allowed). The collection stays in the browser and is sent with the build.

### My decks

Finished decks are kept in the browser (up to 30) as compact share payloads, and reopen with fresh card data.

### Short share links

Shared decks are stored for a year (renewed whenever someone opens the link) in Upstash Redis, which has a free tier. On Vercel: **Storage → Create Database → Upstash for Redis** (or the Marketplace), connect it to this project, and redeploy. The integration adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. Elsewhere, create a free database at upstash.com and set those two variables yourself. The same deck always gets the same link, and links fall back to the long form if the store is unreachable.

**Why did a shared link ask for a Vercel login?** Vercel's default Deployment Protection puts a login in front of deployment URLs (`yourproject-abc123-you.vercel.app`, the "Visit" button in the dashboard). Only the production domain is public. Share links now always use the production domain (or `SITE_URL`), so this can't happen anymore.

**Cost:** each build is one Claude conversation of about 4–8 turns, paid from your own API account. The skill prompt and the growing conversation are prompt-cached. Set a monthly spend limit in the Claude Console (Billing → Spend limits) as an extra guard.

**Function duration:** a build usually takes 1–3 minutes. On Vercel, `app/api/generate/route.ts` sets `maxDuration = 300`, which is the Hobby maximum on Fluid compute. The agent submits by about 3½ minutes and stops at about 4½ minutes with the best deck it has, so it finishes inside the limit. On Pro you can raise `maxDuration` (the maximum is 800). Docker and Node.js have no such limit.

**Keeping your copy up to date:** use **Sync fork** on GitHub (or `git pull` for Docker). Vercel redeploys automatically when your copy changes.

## Engine quality and evals

The engine has two versions. Every change in `v2` is behind its own switch, so it can be measured against `v1` before it becomes the default.

| Switch | What it does | Why it should give better decks |
|---|---|---|
| `prompt2` | Claude plans the 99 slots before searching, spends its searches on the seeds' theme and on recent cards, and skips searches for staples it already knows | Its memory is weakest on synergy pieces and new cards, which is where the deck's identity comes from |
| `fullText` | Search results carry the full Oracle text instead of a 140-character excerpt | Less guessing from memory, fewer misread cards |
| `strict` | The server counts lands, ramp, draw, removal and colored sources from the card text itself (`lib/shared/analysis.ts`). Big gaps are errors on the first two submits | Claude no longer grades its own role tags |
| `review` | After the first legal deck, Claude gets the server's analysis and makes up to 10 swaps with a cheap `revise_deck` tool | Critiquing a concrete list with hard numbers is easier than getting 99 cards right in one pass |
| `manabase` | The server re-splits the basic lands across colors by colored-source targets and mana symbols | Counting pips over 99 cards is arithmetic, which code does better |
| `combos` | [Commander Spellbook](https://commanderspellbook.com) checks the deck; two-card combos it rates Ruthless are errors (unless both pieces are the user's own picks); Spicy ones are flagged | A cheap two-card combo makes it the wrong deck for a Bracket 3 table |
| `effort` | `ENGINE=v2,effort=xhigh` sets the API's effort level (default: the model's own) | More thinking per turn, at the cost of time |

Thinking is already on: the 5.5 models use adaptive thinking by default.

Specs combine a preset with switches: `v2`, `v2-review`, `v1+strict+fullText`, `v2,effort=xhigh`.

### Running an eval

`evals/hands.json` has 20 seed hands: every color count, tribal and non-tribal, chosen and open commanders, a partner pair, double-faced seeds and all three budgets. The harness builds each hand with each variant and scores every deck:

- whether it's legal, time, token cost, and searches and submits per build;
- objective numbers from the analysis: template roles in range, missing template cards, colored sources short of the Karsten targets, share of generic top-300 EDHREC staples, price against the budget, and too-strong combos;
- a blind A/B judgement: Opus compares each variant's deck with the baseline's on the same hand, twice with the order swapped, and a win only counts when both orders agree.

```bash
node scripts/eval.mjs check                          # hands resolve on Scryfall, combo service works (no key)
ANTHROPIC_API_KEY=sk-ant-... node scripts/eval.mjs run --variants v1,v2 --hands 6 --judge claude-opus-5-5
```

The output folder (`evals/out/<time>/`) holds `report.md`, `results.json` and every decklist with its analysis, so you can read the decks yourself too.

In GitHub, add the repository secret `ANTHROPIC_API_KEY` (preferably from a Console workspace with a spend limit), then run **Actions → eval → Run workflow**. The report appears in the run summary and on the `ci-output` branch under `evals/`.

## Develop

```bash
cd web
npm install
cp .env.example .env.local   # add your key, or leave it empty for demo mode
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Server unit tests (Node's test runner, bundled with esbuild): validation, the SSE parser, the draft scanner, the agent loop with scripted "Claude" turns, rate limiting, partner rules, deadlines |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `node scripts/e2e-demo.mjs` | End-to-end check against a running server in demo mode (uses real Scryfall) |
| `node scripts/screenshots.mjs` | Screenshots of every screen (needs `playwright`) |
| `node scripts/check-scryfall-live.mjs` | Checks double-faced, split and accented card names against the live Scryfall API |

CI (`.github/workflows/web.yml`) runs all of these on every push, and also builds and tests the Docker image. It publishes the screenshots, the e2e log and the lockfile it resolved to the `ci-output` branch.

### Layout

```
app/                    Next.js routes: page, layout, CSS, /api/generate, /api/config, /api/cards/*
components/             App (flow and state), SeedHand, CardSearch, ForgeView (live build), DeckView, CardFace
lib/server/             agent loop, engine variants, Claude streaming client, Scryfall client, validation, combo check, prompt, demo
lib/shared/             types, bracket rules, deck analysis, deck statistics and export
evals/                  eval hands, runner, scorecard, blind judge, report
lib/skill/content.ts    generated from ../mtg-master
scripts/                sync-skill, test runner, e2e, screenshots
tests/                  unit tests and Scryfall fixtures
```

## Notes

- Bracket 3 rules were checked on 2026-10-24 against Wizards' Commander format page and the Commander Brackets updates of October 2025 and February 2026. They're in `lib/shared/bracket.ts`; update them when Wizards changes the brackets.
- Prices are Scryfall's Cardmarket (EUR) trend prices and change daily.
- Hundredfold is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images come from [Scryfall](https://scryfall.com) and follow its [API rules](https://scryfall.com/docs/api): it's free to use, with no paywall, and artists are credited.
