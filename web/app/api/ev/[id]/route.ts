import { evProduct } from "../../../../lib/server/ev-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const p = await evProduct(id);
    if (!p) return Response.json({ error: "Unknown product." }, { status: 404 });
    return Response.json(p, { headers: { "cache-control": "public, s-maxage=1800, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "The Box EV data couldn't be loaded. Try again in a minute." }, { status: 502 });
  }
}
