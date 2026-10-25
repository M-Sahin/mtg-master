// Engine variants. Every quality change is behind a switch, so the eval harness
// (evals/run.ts) can compare variants on the same seed hands before one becomes the default.
//
// ENGINE=v1 is the original engine; ENGINE=v2 turns every improvement on.
// A spec can adjust a preset: "v2-review", "v1+strict+fullText", "v2,effort=xhigh".

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface EngineOptions {
  name: string;
  /** 1 = original adapter prompt; 2 = plan first, research the theme, fewer staple searches. */
  prompt: 1 | 2;
  /** Full Oracle text in search results instead of a 140-character excerpt. */
  fullText: boolean;
  /** output_config.effort; null = the model's default (high on Sonnet 5.5, medium on Opus/Haiku 5.5). */
  effort: Effort | null;
  /** Objective role/land/source gaps (counted from Oracle text) are errors, not warnings. */
  strict: boolean;
  /** After the first legal deck: one review round with the analysis report and up to 10 swaps. */
  review: boolean;
  /** The server re-splits the basic lands across colors by colored-source needs. */
  manabase: boolean;
  /** Commander Spellbook combo check: cheap early two-card combos are errors. */
  combos: boolean;
}

const FLAGS = ["fullText", "strict", "review", "manabase", "combos"] as const;

export const PRESETS: Record<string, Omit<EngineOptions, "name">> = {
  v1: { prompt: 1, fullText: false, effort: null, strict: false, review: false, manabase: false, combos: false },
  v2: { prompt: 2, fullText: true, effort: null, strict: true, review: true, manabase: true, combos: true },
};

export const DEFAULT_ENGINE = "v1";

/** Parse an engine spec. Unknown parts throw, so a typo in an eval run fails fast. */
export function parseEngine(spec?: string | null): EngineOptions {
  const s = (spec ?? "").trim() || DEFAULT_ENGINE;
  const m = s.match(/^(v\d+)(.*)$/);
  if (!m || !PRESETS[m[1]]) throw new Error(`Unknown engine "${s}". Use v1 or v2, optionally with +flag/-flag/,effort=…`);
  const e: EngineOptions = { name: s, ...PRESETS[m[1]] };
  for (const part of m[2].match(/[+\-,][^+\-,]+/g) ?? []) {
    const op = part[0];
    const body = part.slice(1).trim();
    if (op === ",") {
      const [k, v] = body.split("=");
      if (k === "effort" && ["low", "medium", "high", "xhigh", "max", "default"].includes(v)) e.effort = v === "default" ? null : (v as Effort);
      else if (k === "prompt" && (v === "1" || v === "2")) e.prompt = Number(v) as 1 | 2;
      else throw new Error(`Unknown engine option "${body}"`);
      continue;
    }
    if (body === "prompt2") e.prompt = op === "+" ? 2 : 1;
    else if ((FLAGS as readonly string[]).includes(body)) (e as any)[body] = op === "+";
    else throw new Error(`Unknown engine flag "${body}" (flags: prompt2, ${FLAGS.join(", ")})`);
  }
  return e;
}
