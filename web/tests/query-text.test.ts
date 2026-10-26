// Scryfall queries in plain words for the build log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeQuery } from "../lib/shared/query-text";

test("common queries read as plain words; the deck's own filters are left out", () => {
  const cases: [string, string | null][] = [
    ["id<=bg f:commander otag:sacrifice-outlet t:creature", "sacrifice outlets (creatures)"],
    ['id<=bg f:commander o:"whenever another creature you control dies"', "cards with “whenever another creature you control dies”"],
    ["id<=bg f:commander otag:ramp mv<=3 -t:land", "ramp, mana value 3 or less, no lands"],
    ["id<=ubg (otag:draw or otag:card-advantage) mv<=2", "card draw or card advantage, mana value 2 or less"],
    ['t:instant or t:sorcery o:"copy target" id<=ur', "instants or sorceries with “copy target”"],
    ["is:commander id>=bg", "commanders"],
    ["id<=rw f:commander t:equipment usd<5", "Equipment, under $5"],
    ["f:commander id<=u", null], // nothing to say: the log shows the query itself
  ];
  for (const [q, want] of cases) assert.equal(describeQuery(q), want, q);
});
