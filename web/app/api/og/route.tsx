import { ImageResponse } from "next/og";
import { named, previewArt } from "../../../lib/server/scryfall";
import { decodePayload } from "../../../lib/shared/share";
import { MANA_COLORS } from "../../../lib/shared/deck-utils";

export const runtime = "nodejs";

// 800×420 keeps the PNG under ~300 KB, which WhatsApp needs to show the preview.
const W = 800;
const H = 420;
const k = W / 1200;
const px = (n: number) => Math.round(n * k);
const ART_W = 470; // the art covers the right part only: less photo = a smaller PNG

// Link-preview image for shared decks (WhatsApp, Reddit, Discord, ...).
export async function GET(request: Request) {
  const d = new URL(request.url).searchParams.get("d") ?? "";
  let title = "Hundredfold";
  let sub = "Five cards in. A hundred out.";
  let art: string | null = null;
  let fullCard = false;
  let credit = "";
  let colors: string[] = [];
  try {
    const p = await decodePayload(d);
    title = p.n;
    sub = `Bracket 3 Commander deck led by ${p.c}${p.p ? ` and ${p.p}` : ""}`;
    const cmd = await named(p.c);
    const img = cmd ? await previewArt(cmd.name) : null;
    if (img && img.artist) {
      art = img.src;
      fullCard = img.full;
      credit = `${cmd!.name}, art by ${img.artist}. © Wizards of the Coast`;
    }
    colors = (cmd?.colorIdentity ?? []).map((c) => MANA_COLORS[c]);
  } catch {
    /* fall back to the generic card */
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#121733", color: "#eef0ff", fontFamily: "serif" }}>
        {art && !fullCard ? <img src={art} width={ART_W} height={H} style={{ position: "absolute", top: 0, right: 0, width: ART_W, height: H, objectFit: "cover" }} /> : null}
        {art && fullCard ? (
          // whole card (with its own credits) on the right instead of a background crop
          <img src={art} width={px(400)} height={px(558)} style={{ position: "absolute", top: px(36), right: px(56), width: px(400), height: px(558), borderRadius: px(20) }} />
        ) : null}
        <div style={{ position: "absolute", top: 0, right: ART_W - px(220), width: px(220), height: H, display: "flex", backgroundImage: "linear-gradient(90deg, rgba(18,23,51,1) 0%, rgba(18,23,51,0) 100%)" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: `${px(64)}px ${px(72)}px`, width: "100%", height: "100%" }}>
          <div style={{ display: "flex", gap: px(10), marginBottom: px(22) }}>
            {colors.map((c, i) => (
              <div key={i} style={{ width: px(30), height: px(30), borderRadius: px(30), background: c, boxShadow: "0 0 0 3px rgba(0,0,0,0.35)" }} />
            ))}
          </div>
          <div style={{ fontSize: px(76), fontWeight: 700, lineHeight: 1.02, maxWidth: px(fullCard ? 640 : 900) }}>{title}</div>
          <div style={{ fontSize: px(32), marginTop: px(18), color: "#c9cdf0", maxWidth: px(fullCard ? 640 : 900) }}>{sub}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: px(44), fontSize: px(24), color: "#e2b04a" }}>
            <span>Built with Hundredfold</span>
            <span style={{ fontSize: px(17), color: "rgba(238,240,255,0.75)" }}>{credit}</span>
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable" } },
  );
}
