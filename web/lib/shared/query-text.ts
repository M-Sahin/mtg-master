// Scryfall search syntax in plain words, for the live build log:
//   id<=bg f:commander otag:sacrifice-outlet t:creature  →  "sacrifice outlets, creatures"
//   o:"whenever another creature you control dies"        →  cards with "whenever another creature you control dies"
// Anything it doesn't recognise is left out; with nothing recognised, the caller shows the query.

const PLURAL: Record<string, string> = {
  creature: "creatures",
  instant: "instants",
  sorcery: "sorceries",
  artifact: "artifacts",
  enchantment: "enchantments",
  planeswalker: "planeswalkers",
  land: "lands",
  legendary: "legendary cards",
  equipment: "Equipment",
  aura: "Auras",
  saga: "Sagas",
  vehicle: "Vehicles",
};

// Scryfall Tagger tags people search for most, where the tag name alone reads badly
const TAGS: Record<string, string> = {
  ramp: "ramp",
  "mana-rock": "mana rocks",
  "mana-dork": "mana creatures",
  draw: "card draw",
  "card-advantage": "card advantage",
  removal: "removal",
  "creature-removal": "creature removal",
  "spot-removal": "spot removal",
  boardwipe: "board wipes",
  sweeper: "board wipes",
  wrath: "board wipes",
  "sacrifice-outlet": "sacrifice outlets",
  "free-sacrifice-outlet": "free sacrifice outlets",
  tutor: "tutors",
  counterspell: "counterspells",
  protection: "protection",
  recursion: "recursion",
  reanimate: "reanimation",
  "death-trigger": "death triggers",
  aristocrats: "death payoffs",
  "token-generator": "token makers",
  lifegain: "lifegain",
  drain: "life drain",
  "graveyard-hate": "graveyard hate",
  "extra-turn": "extra turns",
  landfall: "landfall",
};

const COMPARE: Record<string, string> = { "<=": "or less", ">=": "or more", "<": "less than", ">": "more than", "=": "exactly", ":": "exactly" };

/** Split a query into terms, keeping quoted text together. */
function terms(q: string): string[] {
  return q.match(/-?[\w!]+(?:[:<>=]+)(?:"[^"]*"|\/[^/]*\/|\S+)|-?"[^"]*"|\S+/g) ?? [];
}

type Kind = "what" | "type" | "detail" | "not";

export function describeQuery(query: string): string | null {
  const out: { kind: Kind; text: string }[] = [];
  let or = false;
  const add = (kind: Kind, text: string) => {
    const last = out[out.length - 1];
    if (or && last && last.kind === kind) last.text = `${last.text} or ${text}`;
    else out.push({ kind, text });
    or = false;
  };
  for (const piece of terms(query.trim())) {
    const raw = piece.replace(/^\(+|\)+$/g, "");
    if (/^or$/i.test(raw)) {
      or = true;
      continue;
    }
    const neg = raw.startsWith("-");
    const t = neg ? raw.slice(1) : raw;
    const m = t.match(/^(\w+|!)(<=|>=|<|>|=|:)(.+)$/);
    if (!m) continue;
    const [, key, op, rawVal] = m;
    const val = rawVal.replace(/^"|"$/g, "");
    const k = key.toLowerCase();
    if (["id", "identity", "ci", "c", "color", "f", "format", "legal", "game", "order", "direction", "unique", "prefer"].includes(k)) continue; // implied by the deck
    const under = (v: string, unit = "") => (op === "<" ? `under ${unit}${v}` : op === "<=" ? `${unit}${v} or less` : op === ">" ? `over ${unit}${v}` : op === ">=" ? `${unit}${v} or more` : `${unit}${v}`);
    if (k === "otag" || k === "oracletag" || k === "function") add(neg ? "not" : "what", TAGS[val.toLowerCase()] ?? val.replace(/-/g, " "));
    else if (k === "t" || k === "type") add(neg ? "not" : "type", PLURAL[val.toLowerCase()] ?? val);
    else if (k === "o" || k === "oracle" || k === "fo") add("detail", `${neg ? "without" : "with"} “${val}”`);
    else if (k === "mv" || k === "cmc" || k === "manavalue") add("detail", `mana value ${under(val)}`);
    else if (k === "usd" || k === "eur") add("detail", under(val, k === "eur" ? "€" : "$"));
    else if (k === "is" && val.toLowerCase() === "commander") add(neg ? "not" : "what", "commanders");
    else if (k === "is" && /^(gamechanger|game-changer)$/i.test(val)) add(neg ? "not" : "what", "Game Changers");
    else if (k === "kw" || k === "keyword") add("detail", `with ${val}`);
    else if (k === "name" || k === "!") add("detail", `named “${val}”`);
    else or = false;
  }
  if (!out.length) return null;
  const of = (kind: Kind) => out.filter((x) => x.kind === kind).map((x) => x.text);
  const what = of("what").join(", ");
  const types = of("type").join(", ");
  const head = what && types ? `${what} (${types})` : what || types || "cards";
  const rest = [...of("detail"), ...of("not").map((n) => `no ${n}`)];
  // "sacrifice outlets, creatures with “dies”, mana value 3 or less"
  return rest.length ? `${head} ${rest[0].startsWith("with") ? "" : ", "}${rest.join(", ")}`.replace(/ ,/g, ",").replace(/\s+/g, " ").trim() : head;
}
