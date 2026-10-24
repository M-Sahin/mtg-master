import { random } from "../../../../lib/server/scryfall";

export const dynamic = "force-dynamic";

// A random Commander-legal card for the "surprise me" button.
// kind=commander -> a legal commander; otherwise a playable nonland card (not a Game Changer).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const id = (params.get("id") ?? "").toLowerCase();
  const idFilter = /^[wubrgc]{1,5}$/.test(id) ? ` id<=${id}` : "";
  const q =
    kind === "commander"
      ? "is:commander f:commander -is:gamechanger game:paper"
      : `f:commander -t:land -t:basic -is:gamechanger game:paper (r:u or r:r or r:m)${idFilter}`;
  try {
    const card = await random(q);
    if (!card) return Response.json({ error: "No card" }, { status: 502 });
    return Response.json({ card }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
