import { handleFreeStatus } from "../../../lib/server/generate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleFreeStatus(request);
}
