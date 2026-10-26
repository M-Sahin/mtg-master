"use client";
import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import { MANA_COLORS, parseManaCost } from "../lib/shared/deck-utils";
import type { CardInfo, Color } from "../lib/shared/types";

export function ManaSymbol({ sym }: { sym: string }) {
  const parts = sym.split("/");
  const colors = parts.filter((p) => "WUBRG".includes(p)) as Color[];
  const bg =
    colors.length === 2
      ? `linear-gradient(135deg, ${MANA_COLORS[colors[0]]} 50%, ${MANA_COLORS[colors[1]]} 50%)`
      : colors.length === 1
        ? MANA_COLORS[colors[0]]
        : MANA_COLORS.C;
  const label = colors.length ? (colors.length === 1 && parts.length === 1 ? "" : parts.filter((p) => !"WUBRG".includes(p)).join("")) : sym;
  return (
    <span className="mana" style={{ background: bg }} title={`{${sym}}`} aria-label={`{${sym}}`}>
      {label}
    </span>
  );
}

export function ManaCost({ cost }: { cost: string }) {
  if (!cost) return null;
  return (
    <span className="mana-cost">
      {parseManaCost(cost).map((s, i) => (
        <ManaSymbol key={i} sym={s} />
      ))}
    </span>
  );
}

export function IdentityPips({ colors, size = 14 }: { colors: Color[]; size?: number }) {
  const list = colors.length ? colors : (["C"] as const);
  return (
    <span className="identity" aria-label={`Color identity ${colors.join("") || "colorless"}`}>
      {list.map((c) => (
        <span key={c} className="identity-pip" style={{ background: MANA_COLORS[c as Color | "C"], width: size, height: size }} />
      ))}
    </span>
  );
}

/** A card: Scryfall image when available, a typeset fallback frame otherwise. Optional pointer tilt. */
export function CardFace({
  card,
  name,
  tilt = false,
  className = "",
  style,
  onClick,
  loading = "lazy",
}: {
  card?: CardInfo | null;
  name?: string;
  tilt?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: ReactMouseEvent) => void;
  loading?: "lazy" | "eager";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const title = card?.name ?? name ?? "";
  const move = (e: PointerEvent) => {
    if (!tilt || !ref.current || e.pointerType === "touch") return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    ref.current.style.setProperty("--rx", `${(-y * 14).toFixed(2)}deg`);
    ref.current.style.setProperty("--ry", `${(x * 16).toFixed(2)}deg`);
    ref.current.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
    ref.current.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const leave = () => {
    ref.current?.style.removeProperty("--rx");
    ref.current?.style.removeProperty("--ry");
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      ref={ref as any}
      className={`card ${tilt ? "card--tilt" : ""} ${className}`}
      style={style}
      onPointerMove={move}
      onPointerLeave={leave}
      onClick={onClick}
      type={onClick ? "button" : undefined}
      aria-label={onClick ? `Show ${title}` : undefined}
    >
      <div className="card-fallback" style={{ ["--edge" as string]: edgeColor(card) }} aria-hidden={card?.image && !failed ? true : undefined}>
        <div className="card-fallback-top">
          <span className="card-fallback-name">{title}</span>
          {card?.manaCost ? <ManaCost cost={card.manaCost} /> : null}
        </div>
        <div className="card-fallback-art" />
        <div className="card-fallback-type">{card?.typeLine ?? ""}</div>
        <div className="card-fallback-text">{card?.oracleText ?? ""}</div>
      </div>
      {card?.image && !failed ? <img src={card.image} alt={title} loading={loading} draggable={false} onError={() => setFailed(true)} /> : null}
      {tilt ? <span className="card-glare" aria-hidden /> : null}
    </Tag>
  );
}

function edgeColor(card?: CardInfo | null) {
  const ci = card?.colorIdentity ?? [];
  if (ci.length === 1) return MANA_COLORS[ci[0]];
  if (ci.length > 1) return "#e2b04a";
  return "#9aa0c4";
}
