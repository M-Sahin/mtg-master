import { handleDecks } from "../../../lib/server/account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleDecks(r);
export const POST = (r: Request) => handleDecks(r);
