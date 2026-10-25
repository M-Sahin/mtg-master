import { handleBracketCheck } from "../../../lib/server/bracket-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleBracketCheck(request);
}
