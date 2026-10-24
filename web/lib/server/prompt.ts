// Builds Claude's system prompt from the mtg-master skill (lib/skill/content.ts, generated
// from ../mtg-master by scripts/sync-skill.mjs) plus an adapter for this app's tools.
import { BRACKET } from "../shared/bracket";
import type { Budget, CardInfo, GenerateRequest } from "../shared/types";
import { SKILL_FILES, SKILL_VERSION } from "../skill/content";

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

const ADAPTER = `
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

export function systemPrompt(): string {
  return `${skillContext()}\n${ADAPTER}`.trim();
}

const BUDGET_TEXT: Record<Budget, string> = {
  any: "No budget limit — but don't add expensive cards that don't improve the deck.",
  mid: "Mid budget: aim for roughly €150–250 total (Scryfall EUR prices). Avoid cards over ~€20 unless they're seeds.",
  budget: "Budget: aim for under ~€75 total (Scryfall EUR prices). Avoid cards over ~€3 unless they're seeds; basics are free.",
};

export function userPrompt(req: GenerateRequest, seeds: CardInfo[]): string {
  const lines = seeds.map((s) => `- ${s.name} — ${s.manaCost || "(no cost)"} — ${s.typeLine} — identity ${s.colorIdentity.join("") || "C"}${s.canBeCommander ? " — can be a commander" : ""}`);
  return [
    `Build a Bracket ${BRACKET.number} Commander deck from these five seed cards:`,
    ...lines,
    "",
    req.commander ? `Commander: ${req.commander} (chosen by the user — use it).` : "Commander: not chosen — pick the best commander for these seeds.",
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
        partner: { type: "string", description: "Only if the commander has Partner/Background etc." },
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
