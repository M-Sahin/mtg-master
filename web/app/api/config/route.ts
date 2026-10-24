import { publicConfig } from "../../../lib/server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(publicConfig());
}
