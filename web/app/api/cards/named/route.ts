import { named } from "../../../../lib/server/scryfall";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!name.trim()) return Response.json({ error: "name is required" }, { status: 400 });
  try {
    const card = await named(name.slice(0, 150));
    if (!card) return Response.json({ error: `No card named "${name}"` }, { status: 404 });
    return Response.json({ card }, { headers: { "Cache-Control": "public, s-maxage=86400" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
