// Where magic links and Discord/Google logins come back to.
import { handleCallback } from "../../../lib/server/account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleCallback(r);
