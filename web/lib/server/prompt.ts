// Builds Claude's system prompt from the mtg-master skill (lib/skill/content.ts, generated
// from ../mtg-master by scripts/sync-skill.mjs) plus an adapter for this app's tools.
import { BRACKET } from "../shared/bracket";
import type { Budget, CardInfo, GenerateRequest } from "../shared/types";
import { SKILL_FILES, SKILL_VERSION } from "../skill/content";
import type { EngineOptions } from "./engine";
import { pairingLabel, pairingProblem } from "./validate";

/** Pull "## N. Title" sections out of a reference file. */
export function sections(md: string, numbers: number[]): string {
  const parts = md.split(/\n(?=## )/);
  return parts
    .filter((p) => numbers.some((n) => p.startsWith(`## ${n}.`)))
    .join("\n\n")
    .trim();
}

function stripFrontmatter(md: string) {
  return md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

export function skillContext(): string {
  const f = SKILL_FILES;
  return [
    `<skill name="mtg-master" version="${SKILL_VERSION}">`,
    stripFrontmatter(f["SKILL.md"]),
    `</skill>`,
    `<reference file="references/commander.md">`,
    f["references/commander.md"].trim(),
    `</reference>`,
    `<reference file="references/constructed.md" sections="3">`,
    sections(f["references/constructed.md"], [3]),
    `</reference>`,
    `<reference file="references/lookup.md" sections="3">`,
    sections(f["references/lookup.md"], [3]),
    `</reference>`,
    `<reference file="references/rules.md" sections="9,10">`,
    sections(f["references/rules.md"], [9, 10]),
    `</reference>`,
  ].join("\n");
}

const ADAPTER_V1 = `
<app_adapter>
You are running inside "Hundredfold", a web app that builds a complete Commander deck from five seed cards.
Follow the mtg-master skill above, with these adaptations for this app:

TOOLS (they replace the skill's scripts — you have no shell):
- search_cards: Scryfall search (same syntax as references/lookup.md §3). Replaces scripts/scryfall.py search.
- get_cards: exact Oracle text, type, color identity, legality, price and Game Changer flag for up to 40 names. Replaces scryfall.py cards.
- submit_deck: submit the finished deck. The server validates it like scripts/deckcheck.py (100 cards, singleton, legality, color identity, Game Changers) and returns errors to fix. Your job is done when submit_deck accepts the deck.

THE TASK
- Build exactly one Commander deck for Bracket ${BRACKET.number} (${BRACKET.name}). Bracket rules, verified ${BRACKET.verified}:
${BRACKET.rules.map((r) => `  - ${r}`).join("\n")}
  The Game Changer flag on card data is authoritative and current; respect the limit of ${BRACKET.maxGameChangers}.
- All five seed cards must be in the deck (or be the commander). Build the deck so the seeds matter: find what they have in common and make that the plan.
- If the user picked a commander, use it. Otherwise choose the commander whose color identity covers all five seeds and that best rewards what they do (search with is:commander and id>= the seeds' combined identity; prefer one of the seeds if it's a good fit). If no single legal commander covers the seeds, pick the best one and explain which seed is off-color — but avoid this whenever possible.
- Use the skill's Commander template (references/commander.md §4) and Karsten numbers for colored sources. Count roles honestly.
- Tag every card with exactly one role: ramp, draw, removal, wipe, protection, recursion, synergy, wincon, land, utility. Give each a short "why" (max ~10 words, specific to THIS deck).
- Name 3–6 concrete win conditions. Write the strategy in 2–4 sentences, like a strong player explaining the deck.

EFFICIENCY (the user is watching a live progress screen; keep total time to a few minutes)
- Start with ONE get_cards call for the seeds (and chosen commander).
- Then do focused research: at most ~8 search_cards calls in total, issued in parallel batches of 2–4. Use order:edhrec and the commander's color identity (id<=xx f:commander). Prefer well-known, proven cards.
- Only call get_cards for cards you are unsure about (exact name, legality, Game Changer status). Don't verify every staple.
- Then call submit_deck once with the full list. Put nonbasic lands in "cards" (role "land") and basic lands only in "basics" as counts.
- Count before submitting: 1 commander + cards + basics = exactly 100. Double-check singleton (no duplicates).
- If submit_deck returns errors, fix exactly those and resubmit the whole deck. Don't restart research.
- Keep your visible text short: 1 sentence before each batch of tool calls saying what you're looking for. No long essays — the deck carries the explanation.
</app_adapter>`;

// v2: plan the slots first, spend research on the seeds' theme (where Claude's memory is
// weakest) instead of on staples it already knows, and expect the stricter server checks.
const ADAPTER_V2 = (e: EngineOptions) => `
<app_adapter>
You are running inside "Hundredfold", a web app that builds a complete Commander deck from five seed cards.
Follow the mtg-master skill above, with these adaptations for this app:

TOOLS (they replace the skill's scripts — you have no shell):
- search_cards: Scryfall search (same syntax as references/lookup.md §3). Replaces scripts/scryfall.py search.
- get_cards: exact Oracle text, type, color identity, legality, price and Game Changer flag for up to 40 names. Replaces scryfall.py cards.
- submit_deck: submit the finished deck. The server validates it like scripts/deckcheck.py and also counts roles, lands and colored sources itself from the Oracle text${e.combos ? ", and checks for two-card combos with Commander Spellbook" : ""}. It returns errors to fix.${e.review ? `
- revise_deck: only after the server asks for a review: swap cards in the accepted deck without resubmitting all of it.` : ""}

THE TASK
- Build exactly one Commander deck for Bracket ${BRACKET.number} (${BRACKET.name}). Bracket rules, verified ${BRACKET.verified}:
${BRACKET.rules.map((r) => `  - ${r}`).join("\n")}
  The Game Changer flag on card data is authoritative and current; respect the limit of ${BRACKET.maxGameChangers}. Don't put two-card infinite combos in the deck unless the user asks for combos${e.combos ? "; cheap early ones are rejected by the server" : ""}.
- All five seed cards must be in the deck (or be the commander). The seeds are the point of the deck: the user picked them because they want to play them.
- If the user picked a commander, use it. Otherwise choose the commander whose color identity covers all five seeds and that best rewards what they do (search with is:commander and id>= the seeds' combined identity; prefer one of the seeds if it's a good fit). If no single legal commander covers the seeds, pick the best one and explain which seed is off-color — but avoid this whenever possible.

PLAN BEFORE YOU SEARCH (think this through; don't write it out)
1. Read the seeds' Oracle text. What does each one do and reward (sacrifice, +1/+1 counters, tokens, landfall, spells cast, graveyard, enchantments, combat, life gain…)? Name the deck's one or two core themes and its engines.
2. Budget the 99 slots before picking cards, from references/commander.md §4: about 36–37 lands (an MDFC counts as half), 10 ramp, 10 draw, 8–10 targeted removal/interaction, 2–3 wipes (fewer if you're the creature deck), 3–4 protection/recursion, and the rest (~25–30) theme cards that make the seeds better.
3. Prefer cards that do a template job AND serve the theme (removal that makes tokens in a tokens deck, ramp that sacrifices itself in an aristocrats deck).

RESEARCH WHERE YOUR MEMORY IS WEAKEST
- You already know the format's staples (Sol Ring, Arcane Signet, Signets, Cultivate, Swords to Plowshares, Beast Within, Counterspell…). Don't spend searches on them; trust your knowledge and let submit_deck verify names and legality.
- Spend most searches on the theme: Oracle-text and tagger searches built from what the seeds actually do, inside the commander's identity, e.g. \`id<=bg f:commander o:"whenever another creature you control dies"\`, \`id<=gw f:commander o:"whenever you cast an enchantment spell"\`, \`id<=rg f:commander o:landfall -is:gamechanger\`. Use otag: for functions (otag:sacrifice-outlet, otag:ramp, otag:removal, otag:card-advantage) and o:"…" for the theme's own words.
- Look at recent cards too (add order:released or year>=2024 to a theme search): you know them least, and they are often the best fits.
- About 10–14 search_cards calls in total, in parallel batches of 3–5. Start with ONE get_cards call for the seeds (and chosen commander). Call get_cards for any card whose exact text you haven't seen in a result and aren't sure about.
- Every non-staple card's "why" must say how it connects to the seeds or the plan. If you can't, it's filler: find a better card.

SUBMITTING
- Put nonbasic lands in "cards" (role "land") and basic lands only in "basics" as counts.${e.manabase ? ` Choose the TOTAL number of basics; the server re-splits them across your colors by colored-source needs.` : ""}
- Count before submitting: 1 commander + cards + basics = exactly 100. Double-check singleton (no duplicates).
- Tag every card with exactly one role: ramp, draw, removal, wipe, protection, recursion, synergy, wincon, land, utility, with a short "why" (max ~10 words, specific to THIS deck). The server counts ramp, draw, removal, wipes and lands from the card text, not from your tags, so tag honestly.
- Name 3–6 concrete win conditions. Write the strategy in 2–4 sentences, like a strong player explaining the deck.
- If submit_deck returns errors, fix exactly those and resubmit the whole deck. Don't restart research.${e.review ? `
- After the deck is accepted, the server may send an independent analysis and ask for one review round: answer with revise_deck (up to 10 swaps, or none if the deck is right).` : ""}
- Keep your visible text short: 1 sentence before each batch of tool calls saying what you're looking for. The user is watching a live progress screen; the whole build should take a few minutes.
</app_adapter>`;

export function systemPrompt(engine?: EngineOptions): string {
  const adapter = engine?.prompt === 2 ? ADAPTER_V2(engine) : ADAPTER_V1;
  return `${skillContext()}\n${adapter}`.trim();
}

const BUDGET_TEXT: Record<Budget, string> = {
  any: "No budget limit — but don't add expensive cards that don't improve the deck.",
  mid: "Mid budget: aim for roughly €150–250 total (Scryfall EUR prices). Avoid cards over ~€20 unless they're seeds.",
  budget: "Budget: aim for under ~€75 total (Scryfall EUR prices). Avoid cards over ~€3 unless they're seeds; basics are free.",
};

export function userPrompt(req: GenerateRequest, seeds: CardInfo[]): string {
  const lines = seeds.map((s) => {
    const pair = pairingLabel(s);
    return `- ${s.name} — ${s.manaCost || "(no cost)"} — ${s.typeLine} — identity ${s.colorIdentity.join("") || "C"}${s.canBeCommander ? " — can be a commander" : ""}${pair ? ` — ${pair}` : ""}`;
  });
  // seeds that can share the command zone with each other: point it out, the pair is usually the point
  const pairs: string[] = [];
  for (let i = 0; i < seeds.length; i++)
    for (let j = i + 1; j < seeds.length; j++)
      if (seeds[i].canBeCommander && seeds[j].canBeCommander && !pairingProblem(seeds[i], seeds[j])) pairs.push(`${seeds[i].name} + ${seeds[j].name}`);
  return [
    `Build a Bracket ${BRACKET.number} Commander deck from these five seed cards:`,
    ...lines,
    "",
    req.commander ? `Commander: ${req.commander} (chosen by the user — use it).` : "Commander: not chosen — pick the best commander for these seeds.",
    pairs.length
      ? `These seeds can be co-commanders (both in the command zone; their combined color identity counts): ${pairs.join("; ")}. ${req.commander ? `If ${req.commander} is one of them, use the pair: put ${req.commander} in "commander" and its partner in "partner".` : "Prefer the pair when it fits the seeds."}`
      : "",
    `Budget: ${BUDGET_TEXT[req.budget]}`,
    req.theme?.trim() ? `Theme / wishes from the user: ${req.theme.trim().slice(0, 300)}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const TOOLS = [
  {
    name: "search_cards",
    description:
      "Search Scryfall with full Scryfall syntax (see lookup.md §3), e.g. 'id<=bg f:commander otag:ramp mv<=3'. Returns up to `limit` cards with mana cost, type, color identity, EUR price, Game Changer flag and a short text excerpt.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Scryfall query. Always include f:commander and an id<= color filter." },
        order: { type: "string", enum: ["edhrec", "cmc", "eur", "name", "released"], description: "Sort order (default edhrec = most popular in Commander)" },
        limit: { type: "integer", minimum: 5, maximum: 40, description: "Max results (default 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_cards",
    description: "Exact card data (Oracle text, type, color identity, Commander legality, Game Changer flag, price) for up to 40 card names.",
    input_schema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 40 } },
      required: ["names"],
    },
  },
  {
    name: "submit_deck",
    description:
      "Submit the complete deck. The server checks: exactly 100 cards incl. commander, singleton, Commander legality, color identity, all 5 seeds present, at most 3 Game Changers. Returns 'ACCEPTED' or a list of errors to fix.",
    input_schema: {
      type: "object",
      properties: {
        deck_name: { type: "string", description: "Short evocative deck name" },
        commander: { type: "string" },
        partner: { type: "string", description: "Second commander, only when both can pair: Partner, Partner with, Partner—[same name], Friends forever, a Background, or a Doctor's companion with a Doctor" },
        strategy: { type: "string", description: "2–4 sentences: game plan and how the seeds fit" },
        win_conditions: { type: "array", items: { type: "string" }, description: "3–6 concrete ways the deck wins" },
        bracket_notes: { type: "string", description: "1–2 sentences on why this is Bracket 3 (Game Changers used, no MLD/chained turns/early combos)" },
        cards: {
          type: "array",
          description: "Every card except the commander and basic lands, one entry per card (singleton). Nonbasic lands go here with role 'land'.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string", enum: ["ramp", "draw", "removal", "wipe", "protection", "recursion", "synergy", "wincon", "land", "utility"] },
              why: { type: "string", description: "Max ~10 words" },
            },
            required: ["name", "role", "why"],
          },
        },
        basics: {
          type: "object",
          description: "Basic land counts, e.g. {\"Forest\": 9, \"Swamp\": 8}",
          additionalProperties: { type: "integer", minimum: 0 },
        },
      },
      required: ["deck_name", "commander", "strategy", "win_conditions", "cards", "basics"],
    },
  },
] as const;

export const REVISE_TOOL = {
  name: "revise_deck",
  description:
    "Only when the server asks for a review of an accepted deck: swap cards without resubmitting the whole list. Each swap removes one card and adds one. Basic lands can be swapped like any card (one copy per swap). Send an empty swaps list to keep the deck as it is.",
  input_schema: {
    type: "object",
    properties: {
      swaps: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            out: { type: "string", description: "Exact name of a card in the deck to cut" },
            in: { type: "string", description: "Exact name of the card to add" },
            role: { type: "string", enum: ["ramp", "draw", "removal", "wipe", "protection", "recursion", "synergy", "wincon", "land", "utility"] },
            why: { type: "string", description: "Max ~10 words" },
          },
          required: ["out", "in", "role", "why"],
        },
      },
      strategy: { type: "string", description: "Updated strategy, only if the swaps change it" },
      notes: { type: "string", description: "One sentence on what the review changed" },
    },
    required: ["swaps"],
  },
} as const;

export function toolsFor(engine?: EngineOptions): readonly any[] {
  return engine?.review ? [...TOOLS, REVISE_TOOL] : TOOLS;
}
