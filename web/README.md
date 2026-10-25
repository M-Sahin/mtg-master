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
- **Saving:** the last deck is kept in your browser.
- **Sharing:**
  - the "Share deck" sheet: native sharing on phones, WhatsApp, Reddit (as a link, or a ready-made Markdown post with the decklist), Telegram, X and email
  - "Open in Moxfield/Archidekt", which copies the list and opens their importer
  - shared links open a read-only deck page with fresh card data and the bracket check, and get a preview image (commander art, deck name) in WhatsApp, Reddit and Discord
  - the whole deck is compressed into the link (`/deck?d=…`, about 1.8 KB), so there's no database and self-hosted copies share the same way

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

Hundredfold is free and open source. Run your own copy with your own Claude API key; there's no shared server and nothing to sign up for.

### Option 1: Deploy to Vercel (easiest)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FM-Sahin%2Fmtg-master&root-directory=web&env=ANTHROPIC_API_KEY,ACCESS_CODE&envDescription=Your%20Claude%20API%20key%2C%20and%20an%20access%20code%20visitors%20must%20enter%20%28it%20protects%20your%20API%20credits%29.&envLink=https%3A%2F%2Fgithub.com%2FM-Sahin%2Fmtg-master%2Fblob%2Fmain%2Fweb%2FREADME.md%23environment-variables)

The button copies this repository to your GitHub account, sets the root directory to `web`, and asks for the two required environment variables. That's all you need. Vercel's free Hobby plan is enough.

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
| `ANTHROPIC_API_KEY` | for real builds | Your Claude API key, created at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Without it the app runs in **demo mode**, which replays one scripted Meren deck. |
| `ACCESS_CODE` | yes, with a key | Visitors have to enter this code to start a build. Without it, anyone who has the URL spends your credits, so the app refuses to run until you set it. |
| `PUBLIC_ACCESS` | no | Set it to `1` only if you really want builds open to everyone without a code. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. `claude-opus-5-5` gives stronger decks but is slower and costs more. |
| `BUILDS_PER_HOUR_PER_IP` | no | A best-effort limit per IP, kept per server instance (default 6). |
| `DEMO_MODE` | no | Set it to `1` to force demo mode even when a key is set. Only the value `1` switches it on. |

On Vercel, store `ANTHROPIC_API_KEY` and `ACCESS_CODE` as the **Secret** type. Redeploy after changing a variable, because changes only apply to new deployments.

**Cost:** each build is one Claude conversation of about 4–8 turns, paid from your own API account. The skill prompt and the growing conversation are prompt-cached. Set a monthly spend limit in the Claude Console (Billing → Spend limits) as an extra guard.

**Function duration:** a build usually takes 1–3 minutes. On Vercel, `app/api/generate/route.ts` sets `maxDuration = 300`, which is the Hobby maximum on Fluid compute. The agent submits by about 3½ minutes and stops at about 4½ minutes with the best deck it has, so it finishes inside the limit. On Pro you can raise `maxDuration` (the maximum is 800). Docker and Node.js have no such limit.

**Keeping your copy up to date:** use **Sync fork** on GitHub (or `git pull` for Docker). Vercel redeploys automatically when your copy changes.

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
lib/server/             agent loop, Claude streaming client, Scryfall client, validation, prompt, demo
lib/shared/             types, bracket rules, deck statistics and export
lib/skill/content.ts    generated from ../mtg-master
scripts/                sync-skill, test runner, e2e, screenshots
tests/                  unit tests and Scryfall fixtures
```

## Notes

- Bracket 3 rules were checked on 2026-10-24 against Wizards' Commander format page and the Commander Brackets updates of October 2025 and February 2026. They're in `lib/shared/bracket.ts`; update them when Wizards changes the brackets.
- Prices are Scryfall's Cardmarket (EUR) trend prices and change daily.
- Hundredfold is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images come from [Scryfall](https://scryfall.com) and follow its [API rules](https://scryfall.com/docs/api): it's free to use, with no paywall, and artists are credited.
