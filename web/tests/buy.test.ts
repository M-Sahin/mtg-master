// Buy links: shop carts filled with the deck, affiliate tags applied safely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buyBoxLinks, buyDeckLinks, cartLines, cleanAffiliates, tagLink } from "../lib/shared/buy";
import type { Deck } from "../lib/shared/types";

const deck = {
  name: "t", strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"],
  commander: { name: "Meren of Clan Nel Toth", role: "synergy", why: "", qty: 1 },
  cards: [
    { name: "Sol Ring", role: "ramp", why: "", qty: 1 },
    { name: "Bala Ged Recovery // Bala Ged Sanctuary", role: "recursion", why: "", qty: 1 },
    { name: "Swamp", role: "land", why: "", qty: 12 },
    { name: "Forest", role: "land", why: "", qty: 11 },
  ],
} as Deck;

test("cart lines: commander and nonbasics, front faces, no basics", () => {
  assert.deepEqual(cartLines(deck), ["1 Meren of Clan Nel Toth", "1 Sol Ring", "1 Bala Ged Recovery"]);
});

test("deck links fill each shop's cart; affiliate tags as template or parameters", () => {
  const plain = buyDeckLinks(deck);
  const tcg = plain.find((l) => l.shop === "tcgplayer")!;
  assert.equal(new URL(tcg.href).searchParams.get("c"), "1 Meren of Clan Nel Toth||1 Sol Ring||1 Bala Ged Recovery");
  const ck = plain.find((l) => l.shop === "cardkingdom")!;
  assert.equal(new URL(ck.href).searchParams.get("c"), "1 Meren of Clan Nel Toth\n1 Sol Ring\n1 Bala Ged Recovery");
  assert.ok(plain.every((l) => !l.tagged));
  assert.ok(plain.find((l) => l.shop === "cardmarket")!.copyFirst, "Cardmarket: copy, then paste into a wants list");

  const aff = cleanAffiliates({ tcgplayer: "https://tcgplayer.pxf.io/c/123/456/789?u={url}", cardkingdom: "partner=hundredfoldz&utm_source=hundredfoldz" });
  const tagged = buyDeckLinks(deck, aff);
  const t = tagged.find((l) => l.shop === "tcgplayer")!;
  assert.ok(t.tagged && t.href.startsWith("https://tcgplayer.pxf.io/c/123/456/789?u="));
  assert.equal(new URL(new URL(t.href).searchParams.get("u")!).searchParams.get("productline"), "Magic", "the shop link travels inside, encoded");
  const k = new URL(tagged.find((l) => l.shop === "cardkingdom")!.href);
  assert.equal(k.searchParams.get("partner"), "hundredfoldz");
  assert.ok(k.searchParams.get("c")!.includes("Sol Ring"));
});

test("affiliate settings that could break or hijack a link are dropped", () => {
  assert.deepEqual(
    cleanAffiliates({ tcgplayer: "javascript:alert(1){url}", cardkingdom: "http://evil.example/?u={url}", cardmarket: 'a="b"><script>' }),
    {},
  );
  assert.deepEqual(cleanAffiliates({ cardmarket: "?referrer=muratsahin" }), { cardmarket: "?referrer=muratsahin" });
  assert.equal(tagLink("https://x.example/a?b=1", "?ref=me"), "https://x.example/a?b=1&ref=me");
  assert.equal(tagLink("https://x.example/a", undefined), "https://x.example/a");
});

test("box links search each shop for the box", () => {
  const links = buyBoxLinks("Duskmourn: House of Horror Play Booster Box");
  assert.equal(new URL(links.find((l) => l.shop === "cardmarket")!.href).searchParams.get("searchString"), "Duskmourn: House of Horror Play Booster Box");
  assert.equal(new URL(links.find((l) => l.shop === "tcgplayer")!.href).searchParams.get("q"), "Duskmourn: House of Horror Play Booster Box");
});
