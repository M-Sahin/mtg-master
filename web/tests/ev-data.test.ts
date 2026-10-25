// Box EV data reader: ids are checked, data is cached, stale data beats an outage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EV_ID, deckBoxRows, evDataUrl, evIndex, evProduct, resetEvCache } from "../lib/server/ev-data";

function fake(files: Record<string, unknown>, calls: string[], fail = { on: false }) {
  return (async (url: string) => {
    calls.push(url);
    if (fail.on) throw new Error("down");
    const path = url.replace(evDataUrl() + "/", "");
    if (!(path in files)) return new Response("nope", { status: 404 });
    return Response.json(files[path]);
  }) as unknown as typeof fetch;
}

test("product ids are checked before any request", async () => {
  resetEvCache();
  assert.ok(EV_ID.test("dsk-play") && EV_ID.test("mh3-collector") && EV_ID.test("2x2-draft"));
  assert.ok(!EV_ID.test("../secrets") && !EV_ID.test("dsk-play/../x") && !EV_ID.test("dsk-arena"));
  const calls: string[] = [];
  assert.equal(await evProduct("../../etc/passwd", fake({}, calls)), null);
  assert.equal(calls.length, 0);
});

test("the index is cached, and a cached copy is used when GitHub is down", async () => {
  resetEvCache();
  const calls: string[] = [];
  const fail = { on: false };
  const f = fake({ "index.json": { generatedAt: "x", source: "s", products: [] } }, calls, fail);
  assert.deepEqual((await evIndex(f))?.products, []);
  await evIndex(f);
  assert.equal(calls.length, 1, "second read from memory");
  assert.equal(await evProduct("dsk-play", f), null, "a missing product is null, not an error");
  fail.on = true;
  resetEvCache();
  await assert.rejects(evIndex(f));
});

test("deck rows come from the names index", async () => {
  resetEvCache();
  const names = { products: [{ id: "tst-play", name: "Test Play Booster", kind: "play", packsPerBox: 36, grossBox: 90, released: "2026-01-01" }], names: { "sheoldred, the apocalypse": [[0, 0.2]], "sol ring": [] } };
  const rows = await deckBoxRows([{ name: "Sheoldred, the Apocalypse", price: 60 }, { name: "Sol Ring", price: 1 }], fake({ "names.json": names }, []));
  assert.equal(rows?.length, 1);
  assert.equal(rows![0].product.id, "tst-play");
  assert.equal(rows![0].singles, 60);
  assert.ok(Math.abs(rows![0].deckValue - (1 - Math.exp(-0.2)) * 60) < 0.01);
});
