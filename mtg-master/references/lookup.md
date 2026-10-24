# Looking things up

Scryfall is the source of truth for card data (oracle text, legality, prices, rulings). Wizards of the Coast is the source of truth for rules and ban announcements. Everything else is secondary.

## Contents
1. Which route to use
2. Scryfall API (direct)
3. Scryfall search syntax
4. Fallback when the API is blocked
5. Trusted sources by question type
6. Things that are always time-sensitive

## 1. Which route to use

Try in this order and stop at the first that works:

1. `python3 scripts/scryfall.py ...` from the shell — fastest, handles batches and search. Works when the environment can reach `api.scryfall.com`.
2. Fetch tool directly on `https://api.scryfall.com/...` URLs — works in some environments.
3. Web search for `scryfall <card name>`, then fetch the `scryfall.com/card/...` page from the results. This works almost everywhere because the fetch tool will open URLs that appeared in search results.
4. Memory, clearly flagged as unverified.

If route 1 fails with a network/proxy error, don't retry it with other shell commands — the block applies to the whole shell. Move to route 2/3.

## 2. Scryfall API

Base: `https://api.scryfall.com`. Send a `User-Agent` and `Accept: application/json` header. Keep ≥100 ms between requests.

| Need | Endpoint |
|---|---|
| One card by exact name | `/cards/named?exact=Lightning+Bolt` |
| One card, tolerant of typos | `/cards/named?fuzzy=lightnin+bolt` |
| Search | `/cards/search?q=<query>&order=<name\|released\|edhrec\|usd\|cmc>&unique=<cards\|prints>` |
| Up to 75 cards at once | `POST /cards/collection` with `{"identifiers":[{"name":"..."}]}` |
| Rulings | the `rulings_uri` on the card object |
| Sets (newest first) | `/sets` |
| Random card | `/cards/random?q=<query>` |

Useful card fields: `name`, `mana_cost`, `cmc`, `type_line`, `oracle_text`, `power`, `toughness`, `loyalty`, `colors`, `color_identity`, `keywords`, `legalities` (dict of format → legal/not_legal/banned/restricted), `game_changer` (Commander), `edhrec_rank`, `prices` (usd, usd_foil, eur, tix), `set`, `released_at`, `card_faces` (for DFCs/split/adventure/MDFC — oracle text lives on each face).

## 3. Scryfall search syntax (for `q=`)

| Filter | Example | Meaning |
|---|---|---|
| Color | `c:rg`, `c>=w`, `c:colorless` | card colors |
| Color identity | `id<=esper`, `id:bg` | Commander-legal in that identity |
| Type | `t:creature t:elf`, `t:legendary` | type line |
| Oracle text | `o:"draw a card"`, `fo:` (full oracle incl. reminder) | rules text |
| Oracle tags | `otag:removal`, `otag:ramp`, `otag:card-advantage`, `otag:board-wipe`, `otag:tutor` | functional tags — great for "find me cards that do X" |
| Mana value | `mv<=2`, `mv=3` | |
| Mana cost | `m:{G}{G}`, `m>={W}{U}` | |
| P/T | `pow>=4`, `tou<=1` | |
| Keyword | `kw:flying`, `kw:ward` | |
| Format | `f:pioneer`, `banned:modern`, `restricted:vintage` | legality |
| Rarity | `r:c`, `r>=r` | |
| Set / era | `s:<code>`, `year>=2024`, `date>=<set code>` | |
| Platform | `game:arena`, `game:mtgo`, `game:paper` | |
| Price | `usd<1`, `tix<0.5` | |
| Commander | `is:commander`, `is:partner`, `is:gamechanger` (if supported; else check `game_changer` field) | |
| Misc | `is:dfc`, `is:mdfc`, `is:split`, `is:reprint`, `not:reprint`, `is:firstprint` | |

Combine with spaces (AND), `or`, parentheses and `-` for negation:
`f:pioneer c:b otag:removal mv<=2 order:edhrec` — cheap black removal in Pioneer.
`id<=golgari otag:ramp -t:land f:commander usd<2 order:edhrec` — budget Golgari ramp for Commander.

Order with `order:edhrec` for popularity in Commander; `order:released dir:desc` for newest.

## 4. Fallback when the API is blocked

- Search the web for `scryfall <exact card name>` and fetch the first `scryfall.com/card/...` result. Ask the fetch tool for "exact oracle text, mana cost, type line, P/T and the full legality list".
- For search-style questions ("best green ramp in Pioneer"), search the web for format-specific resources (MTGGoldfish format staples, EDHREC theme pages) and verify the specific cards you pick.
- Gatherer (`gatherer.wizards.com`) also has oracle text and rulings.
- For a long decklist where you can't batch-verify, verify the cards that matter (the engine, the combo pieces, anything you're unsure exists or is legal) and say the rest is from memory.

## 5. Trusted sources by question type

| Question | Source |
|---|---|
| Oracle text, legality, rulings, prices | Scryfall |
| Ban/restricted list, B&R announcements | magic.wizards.com (Banned and Restricted page + announcement articles) |
| Which sets are in Standard / rotation dates | whatsinstandard.com, Wizards announcements |
| Comprehensive Rules | magic.wizards.com/en/rules (yawgatog.com has a hyperlinked copy) |
| Commander brackets & Game Changers list | Wizards' Commander bracket announcements; Scryfall `game_changer` field |
| Constructed metagame & decklists | MTGGoldfish metagame pages, MTGTop8, melee.gg results, mtgdecks.net; untapped.gg for Arena ladder |
| Commander popularity & synergy | EDHREC; cEDH: EDHTop16, cEDH decklist database |
| Limited card quality | 17lands.com (GIH WR, ALSA, IWD) |
| Prices | Scryfall price fields, TCGplayer, Cardmarket (EU), MTGGoldfish |

Prefer data from the last 1–2 weeks for metagame claims and say how recent it is.

## 6. Always time-sensitive

Look these up every time rather than trusting memory: newest set and what's in Standard; ban lists for every format; Commander Game Changers list and bracket rules; Arena-specific formats and rebalanced (A-) cards; the current top decks; prices; upcoming set mechanics. Check the current date first so you know how stale your memory could be.
