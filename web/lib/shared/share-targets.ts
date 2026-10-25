// Share targets for a deck link. Pure functions so they're easy to test.
import type { Deck } from "./types";
import { exportText } from "./deck-utils";

export interface ShareContext {
  url: string;
  title: string; // e.g. "Meren's Endless Harvest: a Bracket 3 Commander deck led by Meren of Clan Nel Toth"
}

const enc = encodeURIComponent;

export type ShareTarget = { id: string; label: string; href: string };

export function shareTargets({ url, title }: ShareContext): ShareTarget[] {
  const text = `${title}. Built with Hundredfold.`;
  return [
    // https://faq.whatsapp.com — "click to chat": wa.me/?text=
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${enc(`${text}\n${url}`)}` },
    { id: "reddit", label: "Reddit", href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}` },
    { id: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
    // X counts every link as 23 characters, so the long link fits
    { id: "x", label: "X", href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
    { id: "email", label: "Email", href: `mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}` },
  ];
}

/** Sites without a "prefill a deck" link: we copy the list and open their import page. */
export const IMPORT_SITES = [
  { id: "moxfield", label: "Moxfield", href: "https://moxfield.com/", hint: "Create deck → Import, then paste" },
  { id: "archidekt", label: "Archidekt", href: "https://archidekt.com/", hint: "New deck → Import, then paste" },
] as const;

/** A ready-to-paste Reddit post (Markdown) for r/EDH and friends. */
export function redditPost(deck: Deck, url: string): string {
  const lines: string[] = [];
  lines.push(`**${deck.name}**: Bracket ${deck.bracket ?? 3} Commander deck led by ${deck.commander.name}${deck.partner ? ` and ${deck.partner.name}` : ""}`);
  lines.push("");
  if (deck.strategy) lines.push(deck.strategy, "");
  if (deck.winConditions.length) {
    lines.push("**How it wins**", "");
    for (const w of deck.winConditions) lines.push(`* ${w}`);
    lines.push("");
  }
  lines.push(`[Full list with card images](${url})`, "");
  // four-space indentation = code block in both old and new Reddit
  for (const l of exportText(deck).trim().split("\n")) lines.push(l ? `    ${l}` : "");
  lines.push("", "^(Built with Hundredfold, the open-source Commander deckbuilder.)");
  return lines.join("\n");
}
