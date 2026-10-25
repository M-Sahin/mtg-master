import { evIndex } from "../../../lib/server/ev-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const index = await evIndex();
    if (!index) return Response.json({ error: "No Box EV data has been published yet." }, { status: 404 });
    return Response.json(index, { headers: { "cache-control": "public, s-maxage=1800, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "The Box EV data couldn't be loaded. Try again in a minute." }, { status: 502 });
  }
}
