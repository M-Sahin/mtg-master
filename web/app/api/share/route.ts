import { handleShare } from "../../../lib/server/share-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleShare(request);
}
