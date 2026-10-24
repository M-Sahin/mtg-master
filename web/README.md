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

## Deploy to Vercel

1. In Vercel, choose **Add New → Project** and import `M-Sahin/mtg-master`.
2. Set **Root Directory** to `web`. The framework is detected as Next.js; keep the default build settings.
3. Add environment variables:

   | Variable | Required | What it does |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | for real builds | Your Claude API key. Without it the app runs in **demo mode**, which replays one scripted Meren deck. |
   | `ACCESS_CODE` | yes, with a key | Visitors have to enter this code to start a build. Without it, anyone who has the URL spends your credits, so the app refuses to run until you set it. |
   | `PUBLIC_ACCESS` | no | Set it to `1` only if you really want builds open to everyone without a code. |
   | `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5-5`. `claude-opus-5-5` gives stronger decks but is slower and costs more. |
   | `BUILDS_PER_HOUR_PER_IP` | no | A best-effort limit per IP, kept per server instance (default 6). |
   | `DEMO_MODE` | no | Set it to `1` to force demo mode even when a key is set. |

4. Deploy, then open the URL and build a deck.

**Function duration:** a build usually takes 1–3 minutes. `app/api/generate/route.ts` sets `maxDuration = 300`, which is the Hobby maximum on Vercel's Fluid compute. The agent submits by about 3½ minutes and stops at about 4½ minutes with the best deck it has, so it finishes inside the limit. On Pro you can raise `maxDuration` (the maximum is 800).

**Cost:** each build is one Claude conversation of about 4–8 turns. The skill prompt and the growing conversation are prompt-cached. Set a monthly spend limit in the Anthropic Console as an extra guard.

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

CI (`.github/workflows/web.yml`) runs all of these on every push. It publishes the screenshots, the e2e log and the lockfile it resolved to the `ci-output` branch.

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
- This is an unofficial fan project, not affiliated with Wizards of the Coast or Scryfall. Card images and data come from Scryfall.
