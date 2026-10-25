// Parse a card collection from a CSV export (Moxfield, Archidekt, ManaBox, Deckbox, Dragon Shield…)
// or a plain list ("1 Sol Ring", "1x Sol Ring (CMR) 263 *F*", "Sol Ring"). Returns unique names.
import { MAX_COLLECTION } from "./types";

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const NAME_HEADERS = ["name", "card name", "card", "cardname", "card_name"];

function fromCsv(lines: string[]): string[] | null {
  const head = lines[0] ?? "";
  const sep = [",", ";", "\t"].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  if (head.split(sep).length < 2) return null;
  const cols = splitCsvLine(head, sep).map((c) => c.toLowerCase().replace(/^﻿/, ""));
  const idx = cols.findIndex((c) => NAME_HEADERS.includes(c));
  if (idx < 0) return null;
  const names: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const name = splitCsvLine(line, sep)[idx];
    if (name) names.push(name);
  }
  return names;
}

function fromList(lines: string[]): string[] {
  const names: string[] = [];
  for (let raw of lines) {
    raw = raw.trim();
    if (!raw || /^(\/\/|#)/.test(raw) || /^(commander|sideboard|deck|maybeboard|companion|about|name)\b:?\s*$/i.test(raw)) continue;
    const name = raw
      .replace(/^\d+\s*x?\s+/i, "") // "1 ", "1x ", "4 x "
      .replace(/^x\d+\s+/i, "")
      .replace(/\s+\*[A-Z]+\*\s*$/i, "") // *F*, *E*
      .replace(/\s+\([A-Z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/i, "") // (CMR) 263
      .replace(/\s+\[[^\]]+\]\s*$/, "") // [CMR]
      .replace(/\s+#\S+$/, "")
      .trim();
    if (name) names.push(name);
  }
  return names;
}

export function parseCollection(text: string): { names: string[]; tooMany: boolean } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const names = fromCsv(lines) ?? fromList(lines);
  const seen = new Map<string, string>();
  for (const n of names) {
    const k = n.toLowerCase();
    if (!seen.has(k)) seen.set(k, n);
  }
  const unique = [...seen.values()];
  return { names: unique.slice(0, MAX_COLLECTION), tooMany: unique.length > MAX_COLLECTION };
}
