import { handleDeck } from "../../../../lib/server/account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
export const GET = async (r: Request, ctx: Ctx) => handleDeck(r, (await ctx.params).id);
export const PATCH = async (r: Request, ctx: Ctx) => handleDeck(r, (await ctx.params).id);
export const DELETE = async (r: Request, ctx: Ctx) => handleDeck(r, (await ctx.params).id);
