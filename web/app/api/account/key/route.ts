import { handleSavedKey } from "../../../../lib/server/account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleSavedKey(request);
export const PUT = (request: Request) => handleSavedKey(request);
export const PATCH = (request: Request) => handleSavedKey(request);
export const DELETE = (request: Request) => handleSavedKey(request);
