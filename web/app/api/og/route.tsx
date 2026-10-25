import { ImageResponse } from "next/og";
import { named } from "../../../lib/server/scryfall";
import { decodePayload } from "../../../lib/shared/share";
import { MANA_COLORS } from "../../../lib/shared/deck-utils";

export const runtime = "nodejs";

// Link-preview image for shared decks (WhatsApp, Reddit, Discord, ...).
export async function GET(request: Request) {
  const d = new URL(request.url).searchParams.get("d") ?? "";
  let title = "Hundredfold";
  let sub = "Five cards in. A hundred out.";
  let art: string | null = null;
  let credit = "";
  let colors: string[] = [];
  try {
    const p = await decodePayload(d);
    title = p.n;
    sub = `Bracket 3 Commander deck led by ${p.c}${p.p ? ` and ${p.p}` : ""}`;
    const cmd = await named(p.c);
    if (cmd?.artCrop && cmd.artist) {
      art = cmd.artCrop;
      credit = `${cmd.name}, art by ${cmd.artist}. © Wizards of the Coast`;
    }
    colors = (cmd?.colorIdentity ?? []).map((c) => MANA_COLORS[c]);
  } catch {
    /* fall back to the generic card */
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#121733", color: "#eef0ff", fontFamily: "serif" }}>
        {art ? <img src={art} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} /> : null}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", backgroundImage: "linear-gradient(90deg, rgba(14,18,44,0.97) 0%, rgba(14,18,44,0.85) 55%, rgba(14,18,44,0.35) 100%)" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "64px 72px", width: "100%", height: "100%" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
            {colors.map((c, i) => (
              <div key={i} style={{ width: 30, height: 30, borderRadius: 30, background: c, boxShadow: "0 0 0 3px rgba(0,0,0,0.35)" }} />
            ))}
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.02, maxWidth: 900 }}>{title}</div>
          <div style={{ fontSize: 32, marginTop: 18, color: "#c9cdf0", maxWidth: 900 }}>{sub}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 44, fontSize: 24, color: "#e2b04a" }}>
            <span>Built with Hundredfold</span>
            <span style={{ fontSize: 16, color: "rgba(238,240,255,0.75)" }}>{credit}</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable" } },
  );
}
