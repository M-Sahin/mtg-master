// The price of one card at each shop, with a link to buy it: Cardmarket (EUR trend) and
// TCGplayer (USD market) from Scryfall, Card Kingdom from its own price list (built daily with
// the Box EV data). Links come back untagged; the page adds the affiliate tags.
import { evCardKingdom } from "./ev-data";
import { printPrices, type PrintPrice } from "./scryfall";
import { nameKey } from "../shared/types";

export interface Offer {
  shop: "cardmarket" | "tcgplayer" | "cardkingdom";
  price: number | null;
  currency: "EUR" | "USD";
  url: string;
  /** which printing the price is for, e.g. "DSK #123" */
  printing?: string;
  foil?: boolean;
  /** Card Kingdom: false = sold out right now */
  inStock?: boolean;
}

const enc = encodeURIComponent;
const isHost = (u: string, host: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === host || x.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
};

/** Scryfall's shop links carry Scryfall's own referral: keep only the shop page itself. */
export function shopUrl(shop: "tcgplayer" | "cardmarket", link: string | undefined, name: string): string {
  if (shop === "tcgplayer") {
    if (link) {
      try {
        const inner = new URL(link).searchParams.get("u");
        const page = inner ?? link;
        if (isHost(page, "tcgplayer.com")) {
          const u = new URL(page);
          for (const k of [...u.searchParams.keys()]) if (/^utm_|^partner|^irclickid/i.test(k)) u.searchParams.delete(k);
          return u.toString();
        }
      } catch {}
    }
    return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${enc(name)}`;
  }
  if (link && isHost(link, "cardmarket.com")) {
    const u = new URL(link);
    u.searchParams.delete("referrer");
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  }
  return `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${enc(name)}`;
}

/** The cheapest printing for a price field, non-foil first, foil if no non-foil copy has a price. */
function cheapest(prints: PrintPrice[], normal: "eur" | "usd", foil: "eurFoil" | "usdFoil") {
  let best: { p: PrintPrice; price: number; foil: boolean } | null = null;
  for (const p of prints) if (p[normal] != null && (!best || p[normal]! < best.price)) best = { p, price: p[normal]!, foil: false };
  if (best) return best;
  for (const p of prints) if (p[foil] != null && (!best || p[foil]! < best.price)) best = { p, price: p[foil]!, foil: true };
  return best;
}

export async function cardOffers(name: string, deps: { prints?: typeof printPrices; ck?: typeof evCardKingdom } = {}): Promise<Offer[]> {
  const [prints, ck] = await Promise.all([(deps.prints ?? printPrices)(name).catch(() => [] as PrintPrice[]), (deps.ck ?? evCardKingdom)().catch(() => null)]);
  const label = (p: PrintPrice) => `${p.set.toUpperCase()} #${p.number}`;
  const eur = cheapest(prints, "eur", "eurFoil");
  const usd = cheapest(prints, "usd", "usdFoil");
  const out: Offer[] = [
    { shop: "cardmarket", currency: "EUR", price: eur?.price ?? null, url: shopUrl("cardmarket", eur?.p.cardmarket, name), ...(eur ? { printing: label(eur.p), foil: eur.foil } : {}) },
    { shop: "tcgplayer", currency: "USD", price: usd?.price ?? null, url: shopUrl("tcgplayer", usd?.p.tcgplayer, name), ...(usd ? { printing: label(usd.p), foil: usd.foil } : {}) },
  ];
  const k = ck?.[nameKey(name)];
  const ckUrl = k?.[1] && /^[\w\-/.%]+$/.test(k[1]) ? `https://www.cardkingdom.com/${k[1].replace(/^\/+/, "")}` : `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${enc(name)}`;
  out.push({ shop: "cardkingdom", currency: "USD", price: k?.[0] ?? null, url: ckUrl, ...(k ? { inStock: !!k[2] } : {}) });
  return out;
}
