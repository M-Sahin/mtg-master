// Bracket 3 ("Upgraded") as of October 2026.
// Sources:
// - magic.wizards.com/en/formats/commander: "Bracket 3 allows for up to three Game Changers."
// - Commander Brackets Beta Update, Oct 21 2025: bracket 3 expects "Game Changers that are likely to
//   be value engines and game-ending spells" and "at least six turns"; tutor limits were removed.
// - Feb 9 2026 update: no bracket-level changes (Game Changer list updated).
// The Game Changers list itself is read live from Scryfall (`game_changer` field / is:gamechanger).

export const BRACKET = {
  number: 3,
  name: "Upgraded",
  maxGameChangers: 3,
  minTurns: 6,
  verified: "2026-10-24",
  rules: [
    "Up to three Game Changers (Wizards' official limit).",
    "Games should last at least ~6 turns: no fast, cheap two-card infinite combos.",
    "No mass land denial (destroying, exiling or locking most lands).",
    "Extra-turn cards only in small numbers, never chained or looped.",
    "Tutors are fine (the most efficient ones are Game Changers already).",
  ],
} as const;

export const COMMANDER_TEMPLATE = {
  lands: [35, 38],
  ramp: [9, 12],
  draw: [9, 12],
  removal: [8, 12],
  wipe: [2, 4],
  protection: [2, 5],
} as const;
