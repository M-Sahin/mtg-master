import { handleStop } from "../../../../lib/server/generate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleStop(request);
}
