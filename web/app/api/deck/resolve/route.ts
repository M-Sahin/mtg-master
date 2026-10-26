import { decodePayload, MAX_PARAM } from "../../../../lib/shared/share";
import { resolveShared } from "../../../../lib/server/shared-deck";
import { LIMITS, guard } from "../../../../lib/server/ratelimit";

export const dynamic = "force-dynamic";

// POST { d } -> { deck, validation }. Only Scryfall lookups (cached), no Claude calls.
export async function POST(request: Request) {
  const limited = await guard(request, LIMITS.resolve);
  if (limited) return limited;
  let d = "";
  try {
    const body = await request.json();
    d = typeof body?.d === "string" ? body.d : "";
  } catch {}
  if (!d || d.length > MAX_PARAM) return Response.json({ error: "This share link is broken or incomplete." }, { status: 400 });
  try {
    const payload = await decodePayload(d);
    return Response.json(await resolveShared(payload));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
