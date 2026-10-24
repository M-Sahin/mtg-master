import { handleGenerate } from "../../../lib/server/generate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel: 300 s is the Hobby maximum (Pro can raise this to 800).
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleGenerate(request);
}
