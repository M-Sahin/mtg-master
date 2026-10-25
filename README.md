# MTG Master: a Claude Skill for Magic: The Gathering

[![tests](https://github.com/M-Sahin/mtg-master/actions/workflows/tests.yml/badge.svg)](https://github.com/M-Sahin/mtg-master/actions/workflows/tests.yml)

**MTG Master** turns Claude into a pro-level Magic player, rules judge and deckbuilder. It answers rules questions with step-by-step reasoning and Comprehensive Rules citations. It builds and reviews decks for 60-card formats, Commander and Limited. Card text, legality and prices are checked against [Scryfall](https://scryfall.com) instead of being recalled from memory.

It covers:

- **Card lookup and search**: exact Oracle text, legality in every format, prices, rulings, and Scryfall search queries such as "cheap black removal in Pioneer".
- **Rules and interactions**: priority, the stack, state-based actions, replacement effects, layers, combat and Commander rules, answered like a judge would.
- **Constructed deckbuilding**: Standard, Pioneer, Modern, Legacy, Vintage, Pauper and the Arena formats. Includes archetype templates, mana bases built from Frank Karsten's colored-source numbers, sideboards and sideboard guides.
- **Commander / EDH**: brackets and Game Changers, a role-based deck template, color identity, and cEDH, Brawl, Oathbreaker, PDH and Duel Commander.
- **Limited**: draft pick orders, signals, 40-card construction, sealed, cube, and how to read 17lands data.
- **Play decisions**: mulligans, sequencing, combat math, figuring out who's the beatdown, and exact draw odds.

## How it works

The skill rests on one rule: **verify, don't recall**. A language model's memory of Magic drifts in two ways. It remembers cards slightly wrong, and it doesn't know about new sets, rotations or bans. So the skill tells Claude to look up anything the answer depends on: Oracle text, legality, the current Standard sets, ban lists, Commander bracket rules, metagame claims and prices.

`SKILL.md` is kept short. It routes each request to the one reference file it needs, so Claude only loads what's relevant:

| Request | Reference loaded |
|---|---|
| "What does X do?", "Is X legal in Y?", card search | `references/lookup.md` |
| Rules question, card interaction, judge call | `references/rules.md` |
| Build, tune or review a 60-card deck; play decisions | `references/constructed.md` |
| Commander, EDH, Brawl, cEDH, Oathbreaker | `references/commander.md` |
| Draft, sealed, prerelease, cube | `references/limited.md` |

Three small Python helpers (standard library only, no dependencies) do the work that shouldn't be done in Claude's head: card lookups, decklist validation and probability math.

## Web app: Hundredfold

[`web/`](web) contains **Hundredfold**, a Next.js app built on this skill. You pick five cards, and Claude builds a complete Bracket 3 Commander deck around them. Progress is shown live: Scryfall searches, the list filling a 10×10 grid, and server-side validation with automatic fixes. You can export the result to Moxfield or Arena. It deploys to Vercel with the root directory set to `web`; see [web/README.md](web/README.md).

## Repository layout

```
mtg-master/                  ← the skill itself (this folder is what you install)
├── SKILL.md                 ← entry point: principles, routing, answer style, decklist format
├── references/
│   ├── lookup.md            ← Scryfall API + search syntax, fallbacks, trusted sources
│   ├── rules.md             ← judge-style method, CR anchors, common misunderstandings
│   ├── constructed.md       ← archetypes, Karsten mana table, sideboards, deck reviews, play
│   ├── commander.md         ← brackets, template, mana base, cEDH and variants
│   └── limited.md           ← draft, sealed, cube, 17lands metrics
└── scripts/
    ├── scryfall.py          ← card / batch / search / rulings / sets lookups
    ├── deckcheck.py         ← decklist validator
    └── odds.py              ← hypergeometric draw probabilities
tests/                       ← offline unit tests (Scryfall is mocked with fixtures)
web/                         ← Hundredfold, the Next.js deckbuilder that uses this skill
.github/workflows/tests.yml  ← CI: runs the tests and packages the skill
```

## Installation

### Claude apps (claude.ai, desktop)

Skills need **code execution** to be enabled in your settings.

1. Build the zip from the root of this repo. The zip must have the `mtg-master/` folder at its root:
   ```bash
   python3 -m zipfile -c mtg-master.zip mtg-master/
   ```
   Don't use GitHub's "Download ZIP" button for this. It wraps everything in an extra `mtg-master-main/` folder, which gives the wrong structure. Every CI run also produces a ready-made `mtg-master.skill` package (a zip with a different extension) under **Actions → latest run → Artifacts**.
2. In Claude, go to **Customize → Skills**, upload the zip and switch the skill on.
3. Test it with a Magic question.

See Anthropic's guide: [Use custom skills](https://support.claude.com/en/articles/12512198-use-custom-skills).

> **Note:** the Help Center currently lists a 200-character limit for the skill description, and this skill's description is longer (about 500 characters). If the upload is rejected for that reason, shorten the `description:` line in `SKILL.md`.

### Claude Code

Copy or symlink the skill folder into a skills directory:

```bash
# for all your projects
cp -r mtg-master ~/.claude/skills/mtg-master

# or just for one project
cp -r mtg-master /path/to/project/.claude/skills/mtg-master
```

See the Claude Code docs: [Skills](https://code.claude.com/docs/en/skills).

## Example prompts

You don't have to name the skill. It triggers on Magic topics, card names and decklists.

- "Does Blood Artist trigger if Rest in Peace is out and my creatures die to a wrath?"
- "Build me a budget Mono-Red deck for Pioneer, I play on Arena."
- "Review my Commander deck. My pod plays at bracket 3." *(paste the list)*
- "How many green sources do I need to cast a 1GG spell on turn 3 in a 60-card deck?"
- "First pick: bomb rare or premium removal? I'm drafting the newest set."
- "What are the odds I have both combo pieces by turn 4?"

## The scripts

You can also run the scripts yourself. Each one supports `--help`.

### `odds.py`: draw probabilities

The opening hand is 7 cards, plus one draw per turn. On the play there's no draw on turn 1.

```console
$ python3 mtg-master/scripts/odds.py turn --deck 60 --copies 4 --turn 3 --draw
P(>= 1 of 4 in 60-card deck, 10 cards seen (turn 3 on the draw)) = 52.8%

$ python3 mtg-master/scripts/odds.py combo --deck 60 --groups 4 3 --turn 4
P(each group [4, 3] hit [1, 1], 10 cards seen (turn 4 on the play)) = 21.4%

$ python3 mtg-master/scripts/odds.py sources --deck 60 --sources 16 --pips 2 --turn 3 --lands 24
P(>= 2 sources among 16, 9 cards seen (turn 3 on the play)) = 76.0%  [unconditional: includes mana screw]
P(>= 2 sources | >= 3 of 24 lands seen) = 87.8%  [Karsten-style: color screw only]
```

With `--lands`, `sources` prints two numbers. The second one assumes you hit your land drops, the way Frank Karsten counts, so it's the one to compare with his tables.

Subcommands: `hit`, `turn`, `range` (land-count distribution), `sources`, `combo` (several card groups at once, with `--need` per group) and `need` ("how many copies do I need for a 90% chance?").

### `deckcheck.py`: decklist validator

```console
$ python3 mtg-master/scripts/deckcheck.py deck.txt --format commander
Format: commander
Commander: Atraxa, Praetors' Voice
Main: 99  Total incl. commander: 100
ERROR: 2 copies of Sol Ring (limit 1).
```

- **Input formats:** Arena exports (`Deck` / `Sideboard` / `Commander` / `Companion` headers, `4 Card (SET) 123`), MTGO and plain text (a blank line before the sideboard), `4x Card`, `SB: 2 Card`, Moxfield-style foil markers and tags, and `Maybeboard` sections (ignored). Use `-` to read from stdin.
- **Offline checks:** deck size, sideboard size, copy limits counted across main deck and sideboard, singleton, basic lands, and cards that allow any number of copies (Relentless Rats, Seven Dwarves and similar).
- **Online checks** (when Scryfall is reachable): every card exists, legality (banned, not legal, or restricted in Vintage), commander color identity, whether the commander is a legal commander, and a land / curve / card-type summary.
- **Formats:** `standard pioneer modern legacy vintage pauper historic explorer timeless alchemy premodern oldschool commander duel paupercommander brawl standardbrawl oathbreaker limited`. Aliases like `edh`, `cedh`, `pdh`, `draft` and `sealed` also work.
- **Exit codes:** `0` means no errors, `1` means errors were found, `2` means bad input.

### `scryfall.py`: card data

```bash
python3 mtg-master/scripts/scryfall.py card "Lightning Bolt"
python3 mtg-master/scripts/scryfall.py cards "Sol Ring" "Arcane Signet" "Command Tower"
python3 mtg-master/scripts/scryfall.py search "f:pioneer c:b otag:removal mv<=2" --order edhrec --limit 20
python3 mtg-master/scripts/scryfall.py rulings "Blood Artist"
python3 mtg-master/scripts/scryfall.py sets --limit 10
```

Add `--json` to any command, before or after it, to get raw JSON. Batch lookups are split into requests of 75 cards, and requests are spaced at least 100 ms apart, as Scryfall's API guidelines ask.

### Network access

`scryfall.py`, and the online part of `deckcheck.py`, need to reach `api.scryfall.com`. Some sandboxes block outbound requests. When that happens, `scryfall.py` exits with code `2` and prints `NETWORK BLOCKED`, and `deckcheck.py` falls back to structural checks and says so. The skill then tells Claude to use its web search and fetch tools instead (see `references/lookup.md`), and to flag anything it couldn't verify.

## Development

```bash
python3 -m unittest discover -s tests -v
```

The 45 tests run fully offline. Scryfall is replaced by fixture cards in `tests/fixtures/cards.json`. Those cards are shaped like real Scryfall objects, but their legalities are simplified for testing, so don't use them as a reference. The probability tests are checked against values from `scipy`, exhaustive enumeration and a Monte Carlo simulation. CI runs the tests on Python 3.8 and 3.12 and packages the skill.

The skill's reference files contain time-sensitive facts, such as Commander brackets and recent rules changes. The skill always tells Claude to verify these, but the files themselves still need updating now and then.

## Changelog

- **1.0.2**: `scryfall.py cards` and `deckcheck.py` couldn't find double-faced cards given by their full "Front // Back" name, because Scryfall's batch endpoint doesn't match those. They now look up the front face, fall back to an exact and then a fuzzy lookup for anything still missing, and CI checks this against the live Scryfall API.
- **1.0.1**: fixes found while testing the original 1.0:
  - `odds.py`: `combo` with a `--need` list shorter than `--groups` used to give a silently wrong answer. It now refuses that input, along with other impossible inputs (more copies or cards seen than the deck has, a `--target` above 1, turn 0). `need` now says when the target can't be reached.
  - `deckcheck.py`: plain-text lists that separate creatures, spells and lands with blank lines used to have everything after the first blank line counted as sideboard. Now only the last block is treated as the sideboard, and only if it fits in 15 cards.
  - `deckcheck.py`: `--commander` is no longer case-sensitive (the commander used to be double-counted). Duel Commander now uses its own ban list instead of regular Commander's. Format aliases added. Clear errors for missing files. Warns when a commander isn't a legal commander and when Scryfall has no legality data for a format.
  - `odds.py sources`: new `--lands` (and `--mv`) options for the Karsten-style probability, which assumes you hit your land drops. Without them, the script's unconditional number looked like it contradicted the Karsten table in `constructed.md` by 8–12 points.
  - Content: `rules.md` wrongly said split second gets around ward (ward is a trigger, so it still works). Tightened the Rest in Peace example in `SKILL.md`. Added the `--lands` guidance to `constructed.md`. `lookup.md` got more reliable fallbacks for when the Scryfall API is blocked (domain-restricted search, the official B&R page for whole-deck legality, the newest set).
  - `scryfall.py`: `--json` now works after the subcommand. `card` exits with code 1 when nothing is found.
  - Added the test suite and CI.
- **1.0**: initial version.

## Credits and disclaimer

Card data comes from the [Scryfall API](https://scryfall.com/docs/api); please follow its usage guidelines. The mana-source numbers are based on Frank Karsten's published analyses. Limited metrics refer to [17lands](https://www.17lands.com).

This is an unofficial fan project. It isn't affiliated with or endorsed by Wizards of the Coast or Scryfall. Magic: The Gathering is a trademark of Wizards of the Coast LLC.

## License

[MIT](LICENSE) © 2026 Murat Sahin
