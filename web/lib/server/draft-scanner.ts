// Incrementally extracts finished card objects from the partial JSON that Claude streams
// for submit_deck, so the UI can show cards landing in the deck while they're written.

export interface DraftItem {
  name: string;
  role: string;
}

export class DraftScanner {
  private pos = -1; // index just inside the "cards" array, -1 = not found yet
  private seen = 0;
  meta: { commander?: string; deckName?: string } = {};

  /** Feed the full accumulated JSON text; returns newly completed cards. */
  feed(text: string): DraftItem[] {
    if (!this.meta.commander) {
      const m = text.match(/"commander"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) this.meta.commander = JSON.parse(`"${m[1]}"`);
    }
    if (!this.meta.deckName) {
      const m = text.match(/"deck_name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) this.meta.deckName = JSON.parse(`"${m[1]}"`);
    }
    if (this.pos < 0) {
      const m = /"cards"\s*:\s*\[/.exec(text);
      if (!m) return [];
      this.pos = m.index + m[0].length;
    }
    const out: DraftItem[] = [];
    // scan complete {...} objects at depth 1 of the array
    let i = this.pos;
    while (i < text.length) {
      while (i < text.length && /[\s,]/.test(text[i])) i++;
      if (i >= text.length || text[i] === "]") break;
      if (text[i] !== "{") {
        i++;
        continue;
      }
      const end = matchObject(text, i);
      if (end < 0) break; // incomplete, wait for more
      try {
        const obj = JSON.parse(text.slice(i, end + 1));
        if (obj && typeof obj.name === "string") out.push({ name: obj.name, role: String(obj.role ?? "utility") });
      } catch {
        /* ignore malformed fragment */
      }
      i = end + 1;
      this.pos = i;
    }
    this.seen += out.length;
    return out;
  }
}

/** Index of the brace closing the object starting at `start`, or -1 if not closed yet. */
function matchObject(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
