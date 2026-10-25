"use client";
// The card view's "Buy this card": the price at each shop (cheapest printing), with a buy link.
import { useEffect, useState } from "react";
import { AFFILIATE_NOTE, tagLink } from "../lib/shared/buy";
import { useSiteConfig } from "../lib/client/site-config";
import type { Offer } from "../lib/server/card-offers";

const LABEL: Record<Offer["shop"], string> = { cardmarket: "Cardmarket", tcgplayer: "TCGplayer", cardkingdom: "Card Kingdom" };
const money = (o: Offer) => (o.price == null ? "No price" : `${o.currency === "EUR" ? "€" : "$"}${o.price.toFixed(2)}`);

export function CardOffers({ name }: { name: string }) {
  const site = useSiteConfig();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setOffers(null);
    setFailed(false);
    fetch(`/api/card-offers?name=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => live && setOffers(j.offers ?? []))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [name]);
  if (failed) return null;
  const aff = site?.affiliates ?? {};
  const tagged = offers?.some((o) => aff[o.shop]);
  return (
    <div className="offers" data-testid="card-offers">
      <span className="opt-label">Buy this card</span>
      {!offers ? (
        <p className="opt-hint">Looking up prices…</p>
      ) : (
        <ul className="offers-list">
          {offers.map((o) => (
            <li key={o.shop} className="offer">
              <span className="offer-shop">{LABEL[o.shop]}</span>
              <span className="offer-price">
                {o.price != null ? "from " : ""}
                <strong>{money(o)}</strong>
                <small>
                  {o.printing ? ` ${o.printing}` : ""}
                  {o.foil ? " · foil" : ""}
                  {o.inStock === false ? " · sold out" : ""}
                </small>
              </span>
              <a className="btn btn--small" href={tagLink(o.url, aff[o.shop])} target="_blank" rel={`noopener noreferrer${aff[o.shop] ? " sponsored" : ""}`}>
                Buy
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="opt-hint">Cheapest printing: Cardmarket trend and TCGplayer market prices via Scryfall, Card Kingdom from its price list. Updated daily.</p>
      {tagged ? <p className="opt-hint buy-disclosure">{AFFILIATE_NOTE}</p> : null}
    </div>
  );
}
