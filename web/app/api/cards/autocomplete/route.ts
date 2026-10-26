import { autocomplete } from "../../../../lib/server/scryfall";
import { LIMITS, guard } from "../../../../lib/server/ratelimit";

export async function GET(request: Request) {
  const limited = await guard(request, LIMITS.autocomplete);
  if (limited) return limited;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json({ data: await autocomplete(q.slice(0, 100)) }, { headers: { "Cache-Control": "public, s-maxage=86400" } });
  } catch (e) {
    return Response.json({ data: [], error: (e as Error).message }, { status: 502 });
  }
}
