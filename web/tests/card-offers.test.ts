// Card buy links: cheapest printing per shop, Scryfall's referral stripped, Card Kingdom from its list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardOffers, shopUrl } from "../lib/server/card-offers";

const prints = async () => [
  { set: "dsk", number: "10", eur: 3.5, eurFoil: 9, usd: 4.1, usdFoil: 12, tcgplayer: "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F55555%3Fpage%3D1", cardmarket: "https://www.cardmarket.com/en/Magic/Products/Search?referrer=scryfall&searchString=Sol+Ring&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall" },
  { set: "c21", number: "263", eur: 0.9, eurFoil: null, usd: 1.6, usdFoil: null, tcgplayer: "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F11111%3Fpage%3D1", cardmarket: "https://www.cardmarket.com/en/Magic/Products/Singles/Commander-2021/Sol-Ring?referrer=scryfall&utm_source=scryfall" },
];

test("offers: the cheapest printing per shop, links without Scryfall's referral", async () => {
  const offers = await cardOffers("Sol Ring", { prints, ck: async () => ({ "sol ring": [1.99, "mtg/commander-2021/sol-ring", 1] }) });
  const cm = offers.find((o) => o.shop === "cardmarket")!;
  assert.equal(cm.price, 0.9);
  assert.equal(cm.printing, "C21 #263");
  assert.equal(cm.url, "https://www.cardmarket.com/en/Magic/Products/Singles/Commander-2021/Sol-Ring");
  const tcg = offers.find((o) => o.shop === "tcgplayer")!;
  assert.equal(tcg.price, 1.6);
  assert.equal(tcg.url, "https://www.tcgplayer.com/product/11111?page=1", "Scryfall's partner wrapper removed");
  const ck = offers.find((o) => o.shop === "cardkingdom")!;
  assert.deepEqual([ck.price, ck.url, ck.inStock], [1.99, "https://www.cardkingdom.com/mtg/commander-2021/sol-ring", true]);
});

test("offers: no prices or data still give search links; foil-only prices are marked", async () => {
  const offers = await cardOffers("Odd Card", { prints: async () => [{ set: "sld", number: "1", eur: null, eurFoil: 20, usd: null, usdFoil: null }], ck: async () => null });
  assert.deepEqual(offers.map((o) => [o.shop, o.price, o.foil ?? null]), [["cardmarket", 20, true], ["tcgplayer", null, null], ["cardkingdom", null, null]]);
  assert.match(offers[1].url, /^https:\/\/www\.tcgplayer\.com\/search\/magic\/product\?.*q=Odd%20Card/);
  assert.match(offers[2].url, /^https:\/\/www\.cardkingdom\.com\/catalog\/search\?/);
  const failing = await cardOffers("X", { prints: async () => Promise.reject(new Error("down")), ck: async () => Promise.reject(new Error("down")) });
  assert.equal(failing.length, 3);
});

test("shop links that point elsewhere are replaced by a search", () => {
  assert.match(shopUrl("tcgplayer", "https://partner.tcgplayer.com/c/1/2/3?u=https%3A%2F%2Fevil.example%2F", "Sol Ring"), /^https:\/\/www\.tcgplayer\.com\/search/);
  assert.match(shopUrl("cardmarket", "https://evil.example/cardmarket.com", "Sol Ring"), /^https:\/\/www\.cardmarket\.com\/en\/Magic\/Products\/Search/);
});
