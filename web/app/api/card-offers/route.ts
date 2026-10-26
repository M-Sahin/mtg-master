// One card's price at each shop, for the card view's buy links.
import { cardOffers } from "../../../lib/server/card-offers";
import { LIMITS, guard } from "../../../lib/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = await guard(request, LIMITS.cardOffers);
  if (limited) return limited;
  const name = (new URL(request.url).searchParams.get("name") ?? "").trim().slice(0, 150);
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  try {
    return Response.json({ offers: await cardOffers(name) }, { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Prices couldn't be loaded." }, { status: 502 });
  }
}
