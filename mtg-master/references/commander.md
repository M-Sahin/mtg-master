# Commander / EDH (and Brawl, cEDH, Oathbreaker)

## Contents
1. What to establish first
2. Power level and brackets
3. Building around a commander
4. Deck template
5. Mana base
6. Reviewing a Commander deck
7. cEDH
8. Brawl and other variants

## 1. What to establish first

- **Commander** (or "I want a deck that does X — suggest commanders").
- **Power target** — the bracket the user's pod plays at. This matters more than anything else; a deck is only "good" relative to its table.
- **Budget** — total and whether they already own staples.
- **Theme or flavor** they care about.

- **Two commanders** are legal only with matching pairing abilities: both have Partner; Partner with each other; the same Partner—[name] ability (e.g. Partner—Father & son, Partner—Survivors); both have Friends forever; Choose a Background plus a Background enchantment; Doctor's companion plus a Time Lord Doctor. The deck's color identity is the union of both.

Look up the commander's exact oracle text and color identity first. Then check the current bracket rules and Game Changers list (they're maintained by Wizards and change).

## 2. Power level and brackets

Wizards' Commander Brackets (introduced 2025) sort decks into five tiers: 1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH. Brackets limit things like the number of "Game Changer" cards, mass land denial, chained extra turns, and early two-card infinite combos. The specific limits and the Game Changers list have been revised since launch — look up the current version before telling a user which bracket their deck is in. On Scryfall, cards on the list have `game_changer: true`.

As of October 2026 (verify; Wizards updates these, most recently in October 2025 and February 2026):

| Bracket | Game Changers | Two-card infinite combos | Mass land denial | Extra turns | Games last about |
|---|---|---|---|---|---|
| 1 Exhibition | none | none intended | no | none | 9+ turns |
| 2 Core | none | none intended | no | a few, never chained | 8+ turns |
| 3 Upgraded | up to 3 | none that come together early | no | a few, never chained | 6+ turns |
| 4 Optimized | any | anything legal | allowed | allowed | 4+ turns |
| 5 cEDH | any | anything legal | allowed | allowed | any turn |

Tutors are no longer limited by bracket (October 2025): the most efficient ones are Game Changers. Brackets 1 and 5 are about intent (a themed, deliberately low-power deck; a deck tuned for competitive play), so a list alone can't prove them. Commander Spellbook (commanderspellbook.com) rates combos; its "Ruthless" combos are the fast ones that belong in bracket 4 and up.

When helping, state which bracket you built for and what would push the deck up or down one bracket. Respect the bracket the user asked for: suggesting fast mana and tutors for a casual pod makes their games worse.

## 3. Building around a commander

1. **Read what the commander asks for.** List its triggers/resources (e.g., "sacrifice outlets + death triggers", "spells cast", "+1/+1 counters"). Those define the synergy package.
2. **Decide the role of the commander:** engine (draws/value every turn → protect it), payoff (wins when assembled), or enabler/voltron (it's the threat).
3. **Find redundancy:** for each key effect the deck relies on, run several cards that do it so the deck works when the commander is removed.
4. **Plan how the deck wins** — explicit win conditions, not "eventually the value wins". Name 3–6 cards or lines that actually end the game.
5. Use EDHREC's commander page for the "high synergy" cards and popular includes, but don't copy the average deck — the average deck is a goodstuff pile. Pick cards that fit the plan.

Scryfall searches are ideal here: `id<=<colors> f:commander otag:<function> order:edhrec`.

## 4. Deck template (starting point for brackets 2–3)

| Role | Count | Notes |
|---|---|---|
| Lands | 35–38 | 36 baseline; fewer with low curve + lots of rocks, more for landfall/high curve |
| Ramp | 9–12 | prioritize 2-mana; land ramp in green, rocks elsewhere |
| Card draw/advantage | 9–12 | repeatable engines > one-shot |
| Targeted removal/interaction | 8–12 | include artifact/enchantment answers and instant-speed options |
| Board wipes | 2–4 | fewer if you're the creature deck |
| Protection/recursion | 2–5 | especially for engine commanders |
| Synergy / theme / win cons | ~25–30 | the deck's actual identity |

Cards often fill two roles (e.g., a creature that ramps); count them once in each category they reliably fill, and say so. Higher brackets cut lands and slow cards for fast mana, tutors and cheaper interaction.

## 5. Mana base

- Two-color: plenty of basics plus untapped duals the budget allows; prioritize colored sources for the color of your commander's and early spells' pips. Karsten 99-card figures (constructed.md) apply — e.g. ~19 sources for a key 1-pip early color.
- Three+ colors: more fixing, fewer utility lands; ramp that fixes (e.g., land-fetching spells) is doubly valuable.
- Count ETB-tapped lands; more than ~6–8 noticeably slows a deck.
- Budget tiers: basics + commons → cheap duals (check-, pain-, slow-, tapped lands) → shocks/fetches/originals. Prices change; check Scryfall.

## 6. Reviewing a Commander deck

1. `scripts/deckcheck.py --format commander --commander "<name>"` — confirms 100 cards, singleton, legality and color identity (with network).
2. Categorize every nonland card by role; compare to the template.
3. Find cards that don't serve the commander's plan or are notably weak for the bracket.
4. Check the mana: land count, ramp count, colored sources vs pip demands, tapped lands.
5. Assess bracket honestly (count Game Changers, combos, tutors, MLD, extra turns).
6. Give a prioritized list of swaps (in / out / why), staying in budget and bracket.

## 7. cEDH

Win by fast combo or stax/control lines around turns 2–5 with heavy interaction (free counterspells, fast mana, tutors). Archetypes: turbo, midrange/blue-farm, stax. The meta shifts — check recent results (EDHTop16, cEDH decklist database) and verify current bans. Every card is evaluated on mana efficiency and whether it wins or stops a win.

## 8. Variants

- **Brawl on Arena:** Arena has 100-card and 60-card Brawl variants with different card pools and life totals; check Arena's current Brawl rules and card pool (`game:arena`) before building.
- **Oathbreaker:** 60 cards, a planeswalker "oathbreaker" plus a signature instant/sorcery; separate banned list — look it up.
- **Pauper Commander (PDH):** uncommon commander, common 99; check its own rules site for bans.
- **Duel Commander:** 1v1, 20 life, its own banned list.
