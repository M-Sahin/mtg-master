import { handleLogout } from "../../../../lib/server/account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (r: Request) => handleLogout(r);
