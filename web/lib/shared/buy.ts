// "Buy the cards" and "Buy this box" links, with optional affiliate tags. Pure functions.
//
// An affiliate setting (AFFILIATE_TCGPLAYER, AFFILIATE_CARDKINGDOM, AFFILIATE_CARDMARKET) is
// either a link template with {url} where the shop link goes (what Impact and similar networks
// give you, e.g. https://tcgplayer.pxf.io/c/123/456/789?u={url}), or query parameters to add to
// the shop link (e.g. partner=yourname&utm_source=yourname).
import type { Deck } from "./types";
import { isBasicLand } from "./types";

export type Shop = "tcgplayer" | "cardkingdom" | "cardmarket";
export type Affiliates = Partial<Record<Shop, string>>;

const enc = encodeURIComponent;
const TEMPLATE = /^https:\/\/[^\s"'<>]+\{url\}[^\s"'<>]*$/;
const PARAMS = /^[?&]?[\w.~%+-]+=[\w.~%+:/-]*(?:&[\w.~%+-]+=[\w.~%+:/-]*)*$/;

/** Keep only well-formed affiliate settings (they end up in links on the page). */
export function cleanAffiliates(raw: Record<string, string | undefined>): Affiliates {
  const out: Affiliates = {};
  for (const shop of ["tcgplayer", "cardkingdom", "cardmarket"] as Shop[]) {
    const v = (raw[shop] ?? "").trim();
    if (v && (TEMPLATE.test(v) || PARAMS.test(v))) out[shop] = v;
  }
  return out;
}

/** The shop link with the affiliate tag applied (or as is without one). */
export function tagLink(url: string, tag?: string): string {
  if (!tag) return url;
  if (tag.includes("{url}")) return tag.replace("{url}", enc(url));
  return `${url}${url.includes("?") ? "&" : "?"}${tag.replace(/^[?&]/, "")}`;
}

/** "1 Card" lines for a shop cart: commander(s) and every nonbasic card, front faces only. */
export function cartLines(deck: Deck): string[] {
  const front = (n: string) => n.split(/\s+\/\/?\s+/)[0].trim();
  return [deck.commander, ...(deck.partner ? [deck.partner] : []), ...deck.cards].filter((c) => !isBasicLand(c.name)).map((c) => `${c.qty} ${front(c.name)}`);
}

export interface BuyLink {
  shop: Shop;
  label: string;
  region: string;
  href: string;
  /** The shop has no "fill a cart" link: copy the list, then open this page. */
  copyFirst?: string;
  tagged: boolean;
}

export function buyDeckLinks(deck: Deck, aff: Affiliates = {}): BuyLink[] {
  const lines = cartLines(deck);
  return [
    {
      shop: "cardmarket",
      label: "Cardmarket",
      region: "Europe",
      href: tagLink("https://www.cardmarket.com/en/Magic/Wants", aff.cardmarket),
      copyFirst: "Create a wants list, choose to add cards as text, and paste",
      tagged: !!aff.cardmarket,
    },
    { shop: "tcgplayer", label: "TCGplayer", region: "US", href: tagLink(`https://www.tcgplayer.com/massentry?productline=Magic&c=${enc(lines.join("||"))}`, aff.tcgplayer), tagged: !!aff.tcgplayer },
    { shop: "cardkingdom", label: "Card Kingdom", region: "US", href: tagLink(`https://www.cardkingdom.com/builder?c=${enc(lines.join("\n"))}`, aff.cardkingdom), tagged: !!aff.cardkingdom },
  ];
}

/** Search links for a sealed box at each shop, e.g. "Duskmourn: House of Horror Play Booster Box". */
export function buyBoxLinks(boxName: string, aff: Affiliates = {}): BuyLink[] {
  const q = enc(boxName);
  return [
    { shop: "cardmarket", label: "Cardmarket", region: "Europe", href: tagLink(`https://www.cardmarket.com/en/Magic/Products/Search?searchString=${q}`, aff.cardmarket), tagged: !!aff.cardmarket },
    { shop: "tcgplayer", label: "TCGplayer", region: "US", href: tagLink(`https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${q}`, aff.tcgplayer), tagged: !!aff.tcgplayer },
    { shop: "cardkingdom", label: "Card Kingdom", region: "US", href: tagLink(`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${q}`, aff.cardkingdom), tagged: !!aff.cardkingdom },
  ];
}

export const AFFILIATE_NOTE = "Some of these are affiliate links: if you buy, Hundredfoldz may earn a small commission at no extra cost to you. It doesn't change what we suggest.";
