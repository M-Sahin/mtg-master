// Singles or boxes? For a deck's cards: the booster boxes that can give them.
import { deckBoxRows } from "../../../../lib/server/ev-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 40_000) return Response.json({ error: "Too many cards." }, { status: 413 });
  const body = await request.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.cards) ? body.cards.slice(0, 120) : [];
  const cards = raw
    .map((c: any) => ({ name: String(c?.name ?? "").trim().slice(0, 150), price: typeof c?.price === "number" && Number.isFinite(c.price) && c.price >= 0 ? Math.min(c.price, 100_000) : null }))
    .filter((c) => c.name);
  if (!cards.length) return Response.json({ error: "Send the deck's cards." }, { status: 400 });
  try {
    const rows = await deckBoxRows(cards);
    if (!rows) return Response.json({ error: "No Box EV data has been published yet." }, { status: 404 });
    return Response.json({ rows });
  } catch {
    return Response.json({ error: "The Box EV data couldn't be loaded." }, { status: 502 });
  }
}
