# Limited: draft, sealed, prerelease, cube

## First: which set?

Limited advice is set-specific. Identify the set (ask if unclear), then look up: its mechanics, the ten two-color archetypes (signposted by the gold uncommons), the common removal, and current 17lands data if the set is on Arena or recent. Your memory of a set may be thin or absent if it's new — check.

## Reading 17lands data

- **GIH WR** (games-in-hand win rate): best single measure of card strength. Compare against the set's average, not an absolute number.
- **IWD** (improvement when drawn): how much drawing the card helps vs not.
- **ALSA** (average last seen at): how early others take it — tells you what will wheel and what's overrated.
- Filter by color pair; a card can be great in one archetype and bad in another. Data is from Arena players, so top-tier tables and paper pods may differ.

## Draft

**Pick priorities (early pack 1):** bombs > premium removal > efficient creatures/evasive threats > combat tricks and situational cards. Stay flexible for the first ~5 picks; take the best card unless it's very close.

**Signals:** strong cards of a color still in the pack at pick 5–9 suggest that color is open upstream. Commit to two colors by mid–pack 2 at the latest; be willing to pivot if pack 1 signals were wrong. Pack 2 passes the other direction.

**Late picks:** filling the curve with playable 2-drops and enough creatures matters more than the 23rd-best card's raw power.

## Deck construction (40 cards)

| Slot | Typical |
|---|---|
| Lands | 17 (16 for low-curve aggro; 18 for heavy top end or lots of mana sinks) |
| Creatures | 14–17 |
| Non-creature spells | 6–9, mostly removal |
| Two-drops | 4–6 |
| Five-plus drops | ≤4–5 |

- Color sources for 40-card decks: about 9 for a main color's early cards; splash only for bombs/removal, with 3–4 sources plus fixing.
- Count your removal and evasive threats; those win Limited games.
- Combat tricks are weaker than removal; run a few only if the archetype rewards them.
- Use `scripts/deckcheck.py --format limited` to confirm 40+ cards.

## Sealed

Six packs; slower and more bomb-driven than draft. Build the deck with the best removal and bombs, splash more readily, and play 17–18 lands. Expect opponents to have bombs — removal is premium.

## Cube

Ask which cube (vintage cube, pauper cube, a CubeCobra link). Archetypes are usually explicit; power level varies enormously, so calibrate.

## Play

- Most Limited games are decided by board presence and card advantage via trades. Who's the beatdown applies here too.
- Think about what common tricks are in the set before attacking into open mana.
- Keep 7-card hands with 2–5 lands and plays; mulligan more cautiously than in constructed.
