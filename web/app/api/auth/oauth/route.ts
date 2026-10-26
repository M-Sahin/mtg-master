import { handleOAuth } from "../../../../lib/server/account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleOAuth(r);
