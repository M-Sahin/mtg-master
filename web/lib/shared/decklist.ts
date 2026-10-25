// Parse a pasted Commander decklist: Moxfield, Archidekt, MTG Arena, MTGO and plain "1 Card" lists.
// Commanders come from a "Commander" section, a *CMDR* / [Commander] marker, or a first or last
// block of one or two cards set apart by a blank line (the server confirms they can lead).

export interface ParsedDeck {
  commanders: string[];
  cards: { name: string; qty: number }[];
  /** Small first/last blocks that may be the commander(s); the server decides. */
  commanderGuess: string[];
  skipped: number; // sideboard / maybeboard lines left out
}

const SECTION = /^(commanders?|command zone|deck|main(?:board)?|mainboard|library|sideboard|maybeboard|considering|tokens?|companion|about|name\b.*)\s*:?\s*(\(\d+\))?$/i;

function cleanLine(raw: string): { name: string; qty: number; cmdr: boolean } | null {
  let line = raw.trim();
  if (!line || /^(\/\/|#)/.test(line)) return null;
  const cmdr = /\*cmdr\*|\[commander/i.test(line);
  line = line
    .replace(/\s*\[[^\]]*\]\s*/g, " ") // [Commander{top}], [CMR]
    .replace(/\s*\*[A-Z]+\*\s*/gi, " ") // *F*, *CMDR*
    .replace(/\s*\^[^^]*\^\s*/g, " ") // ^tags^
    .trim();
  const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  const qty = m ? Math.max(1, Math.min(99, Number(m[1]))) : 1;
  let name = (m ? m[2] : line)
    .replace(/\s+\([A-Z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/i, "") // (CMR) 263
    .replace(/\s+#\S+$/, "")
    .trim();
  if (!name || name.length > 150) return null;
  name = name.replace(/\s+/g, " ");
  return { name, qty, cmdr };
}

export function parseDecklist(text: string): ParsedDeck {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ParsedDeck = { commanders: [], cards: [], commanderGuess: [], skipped: 0 };
  let section: "main" | "commander" | "skip" = "main";
  const blocks: { name: string; qty: number }[][] = [[]];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      if (blocks[blocks.length - 1].length) blocks.push([]);
      continue;
    }
    const sec = t.match(SECTION);
    if (sec && !/^\d/.test(t)) {
      const s = sec[1].toLowerCase();
      section = /^command/.test(s) ? "commander" : /^(sideboard|maybeboard|considering|tokens?)$/.test(s) ? "skip" : "main";
      if (blocks[blocks.length - 1].length) blocks.push([]);
      continue;
    }
    const c = cleanLine(raw);
    if (!c) continue;
    if (section === "skip") {
      out.skipped++;
      continue;
    }
    if (section === "commander" || c.cmdr) out.commanders.push(c.name);
    else {
      out.cards.push({ name: c.name, qty: c.qty });
      blocks[blocks.length - 1].push({ name: c.name, qty: c.qty });
    }
  }
  const nonEmpty = blocks.filter((b) => b.length);
  if (!out.commanders.length && nonEmpty.length >= 2) {
    const small = (b: { qty: number }[]) => b.length <= 2 && b.every((x) => x.qty === 1);
    const first = nonEmpty[0];
    const last = nonEmpty[nonEmpty.length - 1];
    if (small(first)) out.commanderGuess = first.map((x) => x.name);
    else if (small(last)) out.commanderGuess = last.map((x) => x.name);
  }
  // merge duplicate lines
  const merged = new Map<string, { name: string; qty: number }>();
  for (const c of out.cards) {
    const k = c.name.toLowerCase();
    const cur = merged.get(k);
    if (cur) cur.qty += c.qty;
    else merged.set(k, { ...c });
  }
  out.cards = [...merged.values()];
  out.commanders = [...new Set(out.commanders)].slice(0, 2);
  return out;
}
