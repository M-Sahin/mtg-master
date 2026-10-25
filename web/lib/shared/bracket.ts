// Bracket 3 ("Upgraded") as of October 2026.
// Sources:
// - magic.wizards.com/en/formats/commander: "Bracket 3 allows for up to three Game Changers."
// - Commander Brackets Beta Update, Oct 21 2025: bracket 3 expects "Game Changers that are likely to
//   be value engines and game-ending spells" and "at least six turns"; tutor limits were removed.
// - Feb 9 2026 update: no bracket-level changes (Game Changer list updated).
// The Game Changers list itself is read live from Scryfall (`game_changer` field / is:gamechanger).

export type BracketNumber = 1 | 2 | 3 | 4;

export interface BracketInfo {
  number: BracketNumber;
  name: string;
  maxGameChangers: number;
  minTurns: number;
  verified: string;
  hint: string; // one line for the bracket picker
  rules: readonly string[]; // what Claude is told
}

// Sources for brackets 1–4 (checked 2026-10-25): Game Changer limits from
// magic.wizards.com/en/formats/commander; land denial, extra turns and combos from the
// February 2025 brackets; expected game length and "no tutor limits" from the October 2025 update.
export const BRACKETS: Record<BracketNumber, BracketInfo> = {
  1: {
    number: 1,
    name: "Exhibition",
    maxGameChangers: 0,
    minTurns: 9,
    verified: "2026-10-25",
    hint: "Theme first, power last",
    rules: [
      "No Game Changers.",
      "Games should last about nine turns or more: the deck shows off a theme or idea, power comes second.",
      "No two-card infinite combos, no mass land denial, no extra-turn cards.",
      "Tutors are allowed, but this is a casual table: prefer flavorful, on-theme cards over efficient ones.",
    ],
  },
  2: {
    number: 2,
    name: "Core",
    maxGameChangers: 0,
    minTurns: 8,
    verified: "2026-10-25",
    hint: "Like a modern precon",
    rules: [
      "No Game Changers.",
      "Games should last about eight turns or more, at the power of a modern preconstructed deck.",
      "No intentional two-card infinite combos and no mass land denial.",
      "Extra-turn cards only in small numbers, never chained or looped.",
      "Win conditions should be incremental and visible on the board.",
    ],
  },
  3: {
    number: 3,
    name: "Upgraded",
    maxGameChangers: 3,
    minTurns: 6,
    verified: "2026-10-24",
    hint: "Tuned, up to 3 Game Changers",
    rules: [
      "Up to three Game Changers (Wizards' official limit).",
      "Games should last at least ~6 turns: no fast, cheap two-card infinite combos.",
      "No mass land denial (destroying, exiling or locking most lands).",
      "Extra-turn cards only in small numbers, never chained or looped.",
      "Tutors are fine (the most efficient ones are Game Changers already).",
    ],
  },
  4: {
    number: 4,
    name: "Optimized",
    maxGameChangers: 99,
    minTurns: 4,
    verified: "2026-10-25",
    hint: "High power, anything legal",
    rules: [
      "Any number of Game Changers: fast mana, efficient tutors, free interaction and strong engines are expected.",
      "Games can end from about turn four: efficient, compact win conditions, including two-card combos, are fine.",
      "Mass land denial and extra turns are allowed, but build a strong, consistent deck, not a cEDH list.",
      "Everything must still be legal in Commander.",
    ],
  },
};

/** Bracket 3, the default the app was built around. */
export const BRACKET = BRACKETS[3];

export function bracketInfo(n: unknown): BracketInfo {
  const k = Number(n);
  return BRACKETS[(k === 1 || k === 2 || k === 3 || k === 4 ? k : 3) as BracketNumber];
}

export const COMMANDER_TEMPLATE = {
  lands: [35, 38],
  ramp: [9, 12],
  draw: [9, 12],
  removal: [8, 12],
  wipe: [2, 4],
  protection: [2, 5],
} as const;
