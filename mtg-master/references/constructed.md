# Constructed: building, tuning, and playing 60-card decks

## Contents
1. Before you build: what to establish
2. Building from scratch
3. Mana: land counts and color sources
4. Copy counts and slot decisions
5. Sideboards
6. Reviewing a user's deck
7. Budget and platform
8. Play: mulligans, sequencing, combat, matchups

## 1. Before you build

Establish (from the message, or ask in one short question if missing and it changes the build):
- **Format** — and check current legality and bans (lookup.md). Never assume what's in Standard.
- **Goal** — winning a competitive event, ranked Arena ladder, FNM, kitchen table.
- **Budget / platform** — paper $, Arena wildcards, MTGO tix, or "I own these cards".
- **Style** — favorite archetype or card the deck must include.

For competitive goals, check the current metagame (MTGGoldfish/MTGTop8/untapped.gg) before recommending: a deck that's great in a vacuum but bad against the top 3 decks is a bad recommendation. Say how recent your meta data is.

## 2. Building from scratch

1. **Pick a game plan in one sentence.** "Go wide with cheap fliers and win by turn 5 before sweepers matter." Every card should serve it.
2. **Archetype sets the shape:**

| Archetype | Wins by | Typical curve peak | Lands (60) | Card mix guide |
|---|---|---|---|---|
| Aggro | Damage before opponent stabilizes | 1–2 | 20–22 | 22–28 creatures, burn/reach, few reactive cards |
| Tempo | Cheap threats + disruption | 2 | 20–22 | 12–18 threats, counters/bounce/removal, card flow |
| Midrange | Efficient threats + removal, 2-for-1s | 2–3 | 23–25 | ~14–20 threats, 8–12 removal/disruption |
| Control | Answer everything, win late | 2–4 (reactive) | 25–27 | 4–8 win cons, sweepers, counters, draw |
| Ramp | Accelerate into big payoffs | varies | 24–27 incl. mana creatures/rocks | ~8–12 ramp, ~6–10 payoffs |
| Combo | Assemble specific pieces | varies | 18–24 | pieces + tutors/redundancy + protection |

3. **Core first:** identify the 8–16 cards that *are* the deck (the engine or best threats), usually as 4-ofs.
4. **Fill roles:** interaction, card advantage/selection, then lands. Count each role explicitly.
5. **Check the curve:** aggro wants 8+ one/two-drops; most decks want plays on turns 2 and 3; avoid clumps at 4+ unless ramping.
6. **Run `scripts/deckcheck.py`** and fix counts before presenting.

## 3. Mana

**Land count:** start from the table above and adjust for average mana value, mana sinks, card draw and MDFCs (count an MDFC as roughly half to two-thirds of a land). Flooding is usually less damaging than screw for midrange/control; aggro wants to cut lands.

**Colored sources** — to cast a spell on curve about 90% of the time, Frank Karsten's figures are approximately:

| Cost | 60 cards | 40 cards | 99 cards |
|---|---|---|---|
| C (turn 1) | 14 | 9 | 19 |
| 1C (turn 2) | 13 | 9 | 19 |
| 2C (turn 3) | 12 | 8 | 18 |
| 3C (turn 4) | 10 | 7 | 16 |
| CC (turn 2) | 21 | 14 | 30 |
| 1CC (turn 3) | 18 | 12 | 28 |
| 2CC (turn 4) | 16 | 11 | 26 |
| CCC (turn 3) | 23 | 16 | 36 |

A dual land counts as a source for both colors. Fetchlands count for every color they can find. These are approximate. For a specific deck use `scripts/odds.py sources ... --lands <total lands>`: the Karsten-style line (assumes you hit your land drops) is the one comparable to this table. The unconditional line also counts mana screw and reads 8–12 points lower, so don't compare it with the table. In practice two-color decks often can't hit every target — prioritize the colors of your early, important spells and say what you're compromising.

**Mana base quality:** untapped duals > tapped duals for faster decks; count how many lands enter tapped and consider the turn-1/turn-2 cost. Utility lands cost colored consistency — justify each.

## 4. Copy counts

- **4** — core cards you always want to draw, and cards where redundancy is the point.
- **3** — great but costly/legendary/clunky in multiples, or you want it often but not in the opening hand.
- **2** — situational cards, expensive top end, legendary permanents.
- **1** — tutor targets, silver bullets, hedges. Too many 1-ofs makes a deck inconsistent; justify each.

When deciding a slot, ask: what does this card do that the card it replaces doesn't, in the matchups that actually happen?

## 5. Sideboards

- 15 cards aimed at the decks you expect, not every theoretical threat. Each card should come in for at least one popular matchup and be a real upgrade there.
- Prefer flexible cards that come in for several matchups.
- Don't bring in cards that are worse than what you take out; don't dilute the core plan.
- Give a sideboard guide for the top matchups: `vs Deck: +2 X, +1 Y / -2 A, -1 B`, with a line on the plan (who's the beatdown, what to save removal for). Keep ins and outs equal.
- Consider play vs draw: cheap removal is better on the draw; aggressive starts better on the play.

## 6. Reviewing a user's deck

1. Run `scripts/deckcheck.py` (counts, legality, copy limits).
2. Identify the game plan the list is trying to execute — say it back.
3. Look for: wrong land count for the curve, color source shortfalls, too many 1-ofs, cards that don't serve the plan, missing interaction, no plan against the top meta decks, cards with a strictly better option in the format.
4. Give a prioritized change list: highest-impact changes first, each with *in / out / why*. Respect the user's budget and pet cards — offer upgrades, don't steamroll their identity.

## 7. Budget and platform

- **Paper:** use Scryfall prices; note that prices move. Offer a budget version and an "upgrade path" in order of impact per dollar.
- **Arena:** cost in wildcards by rarity (count mythics and rares separately). Check `game:arena` and Arena-only formats (Historic, Timeless, Alchemy, Brawl variants) — some cards are rebalanced (A- prefix) on Arena.
- **MTGO:** tix prices from Scryfall `tix`.
- Be honest when a budget substitute is a real power downgrade.

## 8. Play

**Mulligans (London mulligan):** judge a 7 on (a) 2–4 lands with the colors it needs, (b) something to do on turns 2–3, (c) relevance in the expected matchup. A slow, functional 7 usually beats a 6. Combo decks mulligan more aggressively for pieces; aggro mulligans hands that can't apply early pressure.

**Who's the beatdown:** figure out which player wins the long game. That player plays defensively and trades; the other races and uses removal on blockers. Misassigning this role is the most common strategic error.

**Sequencing heuristics:** play the land that keeps the most options open; cast spells that give information before committing; hold instant-speed interaction when you can afford to; play around sweepers by not overcommitting when ahead; use removal on engine cards and threats that win, not the first creature you see.

**Combat math:** count total damage both ways for the next two turns; consider tricks the opponent could have given their untapped mana; use `scripts/odds.py` for "what are the odds they have it / I draw it" questions.

**Clock:** always know how many turns until each player dies. Decisions that don't change either clock are low priority.
