import { after } from "next/server";
import { handleGenerate, handleResume } from "../../../lib/server/generate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel: 300 s is the Hobby maximum (Pro can raise this to 800).
export const maxDuration = 300;

export async function POST(request: Request) {
  // after(): the build keeps running when the browser disconnects (phone switched apps)
  return handleGenerate(request, { waitUntil: (p) => after(p) });
}

/** Reconnect: GET /api/generate?job=<id>&from=<n> */
export async function GET(request: Request) {
  return handleResume(request);
}
