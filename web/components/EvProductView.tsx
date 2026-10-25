"use client";
// One booster box: average card value, value after selling, your chance to get your price
// back (simulated boxes), the spread, and the cards that carry the value.
import { useDeferredValue, useMemo, useState } from "react";
import { DEFAULT_SELL, KIND_LABEL, chanceAtLeast, evPerPack, expectedPerPack, gross, net, simulateBoxes, topCards, unpricedShare, type EvProduct, type SellOptions } from "../lib/shared/ev";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { BuyLinks } from "./BuyLinks";
import { buyBoxLinks } from "../lib/shared/buy";
import { useSiteConfig } from "../lib/client/site-config";

const eur = (x: number) => `€${Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en") : x.toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const BOXES = 4000;

function NumberField({ label, value, onChange, step = 1, min = 0, suffix, hint, testId }: { label: string; value: string; onChange: (v: string) => void; step?: number; min?: number; suffix?: string; hint?: string; testId?: string }) {
  return (
    <label className="opt ev-field">
      <span className="opt-label">{label}</span>
      <span className="ev-input">
        <input className="field" type="number" inputMode="decimal" step={step} min={min} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
        {suffix ? <span className="ev-suffix">{suffix}</span> : null}
      </span>
      {hint ? <span className="opt-hint">{hint}</span> : null}
    </label>
  );
}

export default function EvProductView({ product, error }: { product: EvProduct | null; error: string | null }) {
  const site = useSiteConfig();
  const [price, setPrice] = useState("");
  const [packs, setPacks] = useState(String(product?.packsPerBox ?? 36));
  const [fee, setFee] = useState(String(DEFAULT_SELL.fee * 100));
  const [cutoff, setCutoff] = useState(String(DEFAULT_SELL.cutoff));
  const [haircut, setHaircut] = useState(String(DEFAULT_SELL.haircut * 100));

  const n = (s: string, d: number) => (Number.isFinite(Number(s)) && s.trim() !== "" ? Number(s) : d);
  const sell: SellOptions = { fee: Math.min(0.5, Math.max(0, n(fee, 5) / 100)), cutoff: Math.max(0, n(cutoff, 1)), haircut: Math.min(0.9, Math.max(0, n(haircut, 0) / 100)) };
  const packCount = Math.max(1, Math.min(60, Math.round(n(packs, product?.packsPerBox ?? 36))));
  const yourPrice = price.trim() ? Math.max(0, n(price, 0)) : null;
  const sellKey = `${sell.fee}|${sell.cutoff}|${sell.haircut}|${packCount}`;
  const deferred = useDeferredValue(sellKey);

  const base = useMemo(() => {
    if (!product) return null;
    const exp = expectedPerPack(product);
    return { exp, grossPack: evPerPack(product, gross, exp), unpriced: unpricedShare(product, exp) };
  }, [product]);

  const calc = useMemo(() => {
    if (!product || !base) return null;
    const [f, c, h, p] = deferred.split("|").map(Number);
    const o = { fee: f, cutoff: c, haircut: h };
    const value = (x: number | null) => net(x, o);
    const netPack = evPerPack(product, value, base.exp);
    const sim = simulateBoxes(product, value, { boxes: BOXES, packs: p });
    const top = topCards(product, gross, 12, p, base.exp);
    const top5 = top.slice(0, 5).reduce((s, t) => s + t.share, 0);
    // histogram of simulated box values (net)
    const lo = sim.sorted[0];
    const hi = sim.sorted[Math.floor(sim.sorted.length * 0.99)];
    const bins = new Array(24).fill(0);
    for (const v of sim.sorted) bins[Math.min(23, Math.max(0, Math.floor(((v - lo) / (hi - lo || 1)) * 24)))]++;
    return { netPack, sim, top, top5, packs: p, bins, lo, hi };
  }, [product, base, deferred]);

  if (!product || !base || !calc) {
    return (
      <div className="app">
        <SiteHeader active="ev" />
        <main className="ev-page">
          <p className="error">{error}</p>
          <p>
            <a href="/ev">See all boxes</a>
          </p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const grossBox = base.grossPack * calc.packs;
  const netBox = calc.netPack * calc.packs;
  const chance = yourPrice != null ? chanceAtLeast(calc.sim, yourPrice) : null;
  const roi = yourPrice ? (netBox - yourPrice) / yourPrice : null;
  const maxBins = Math.max(...calc.bins, 1);
  const date = new Date(product.pricedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="app">
      <SiteHeader active="ev" />
      <main className="ev-page">
        <p className="crumbs">
          <a href="/ev">Box EV</a> / {product.setName}
        </p>
        <section className="ev-head">
          {product.icon ? <img src={product.icon} alt="" width={44} height={44} className="ev-icon ev-icon--big" /> : null}
          <div>
            <h1>
              {product.setName}: {KIND_LABEL[product.kind]} box
            </h1>
            <p className="hero-sub">
              Released {product.released}. Prices from {date}. {product.packs.length > 1 ? `${product.packs.length} pack layouts, ` : ""}
              {Object.keys(product.sheets).length} card slots, {product.cards.length.toLocaleString("en")} possible cards and finishes.
            </p>
          </div>
        </section>

        <div className="ev-grid">
          <section className="panel ev-inputs" aria-label="Your box">
            <h3>Your box</h3>
            <NumberField label="What you pay for the box" value={price} onChange={setPrice} step={1} suffix="€" hint="Put in a shop's price to see if it's worth opening." testId="ev-price" />
            <NumberField label="Packs in the box" value={packs} onChange={setPacks} hint={`A ${KIND_LABEL[product.kind]} box usually has ${product.packsPerBox}.`} />
            <div className="ev-buy">
              <span className="opt-label">Find this box</span>
              <BuyLinks links={buyBoxLinks(`${product.setName} ${KIND_LABEL[product.kind]} Box`, site?.affiliates)} />
            </div>
            <details className="ev-more">
              <summary>Selling costs</summary>
              <NumberField label="Marketplace fee" value={fee} onChange={setFee} step={0.5} suffix="%" hint="Cardmarket charges 5% on each sale." />
              <NumberField label="Cards under this are worth nothing" value={cutoff} onChange={setCutoff} step={0.25} suffix="€" hint="Bulk isn't worth listing one by one." />
              <NumberField label="Sell below the trend price by" value={haircut} onChange={setHaircut} step={1} suffix="%" hint="To sell faster." />
            </details>
          </section>

          <section className="ev-results" aria-label="Results" data-testid="ev-results">
            <div className="ev-stat">
              <span className="ev-stat-label">Average card value</span>
              <span className="ev-stat-big">{eur(grossBox)}</span>
              <span className="ev-stat-sub">{eur(base.grossPack)} a pack, every card at its trend price</span>
            </div>
            <div className="ev-stat">
              <span className="ev-stat-label">After selling</span>
              <span className="ev-stat-big">{eur(netBox)}</span>
              <span className="ev-stat-sub">
                {pct(sell.fee)} fee{sell.cutoff ? `, cards under ${eur(sell.cutoff)} at €0` : ""}
                {sell.haircut ? `, ${pct(sell.haircut)} below trend` : ""}
              </span>
            </div>
            <div className={`ev-stat ${roi == null ? "" : roi >= 0 ? "is-up" : "is-down"}`}>
              <span className="ev-stat-label">Your chance to get {yourPrice != null ? eur(yourPrice) : "your price"} back</span>
              <span className="ev-stat-big" data-testid="ev-chance">
                {chance != null ? pct(chance) : "—"}
              </span>
              <span className="ev-stat-sub">{roi != null ? `Average result ${roi >= 0 ? "+" : ""}${pct(roi)} after selling` : "Put in your price"}</span>
            </div>
          </section>
        </div>

        <section className="panel" aria-label="How boxes vary">
          <h3>How {BOXES.toLocaleString("en")} simulated boxes came out</h3>
          <p className="panel-sub">
            After selling costs. Half the boxes are worth less than {eur(calc.sim.p50)}; one in ten is worth less than {eur(calc.sim.p10)}, and one in ten more than {eur(calc.sim.p90)}. The average ({eur(calc.sim.mean)}) sits above the middle because a few big pulls lift it.
          </p>
          <div className="ev-hist" role="img" aria-label={`Box values from ${eur(calc.lo)} to ${eur(calc.hi)}`}>
            {calc.bins.map((b, i) => {
              const from = calc.lo + ((calc.hi - calc.lo) * i) / calc.bins.length;
              const to = calc.lo + ((calc.hi - calc.lo) * (i + 1)) / calc.bins.length;
              const at = yourPrice != null && yourPrice >= from && yourPrice < to;
              const under = yourPrice != null && to <= yourPrice;
              return <span key={i} className={`ev-bar ${under ? "is-under" : ""} ${at ? "is-at" : ""}`} style={{ height: `${(b / maxBins) * 100}%` }} title={`${eur(from)}–${eur(to)}: ${pct(b / calc.sim.boxes)}`} />;
            })}
          </div>
          <div className="ev-hist-axis">
            <span>{eur(calc.lo)}</span>
            <span>{eur(calc.hi)}</span>
          </div>
          {yourPrice != null ? <p className="opt-hint">Bars below your price are dimmed.</p> : null}
        </section>

        <section className="panel" aria-label="The cards that carry the value">
          <h3>The cards that carry the value</h3>
          <p className="panel-sub">The top five are {pct(calc.top5)} of the box&apos;s average value. Copies per box is the average: 0.25 means one box in four has one.</p>
          <ol className="ev-cards">
            {calc.top.map((t) => (
              <li key={`${t.card.s}${t.card.c}${t.card.f}`} className="ev-card">
                {t.card.img ? <img src={t.card.img} alt="" width={46} height={64} loading="lazy" /> : <span className="ev-card-ph" />}
                <span className="ev-card-name">
                  <strong>{t.card.n}</strong>
                  <small>
                    {t.card.s.toUpperCase()} #{t.card.c}
                    {t.card.f ? " · foil" : ""}
                  </small>
                </span>
                <span className="num">{t.card.p != null ? eur(t.card.p) : "—"}</span>
                <span className="num ev-card-per">{t.perBox >= 0.1 ? t.perBox.toFixed(2) : t.perBox.toFixed(3)} per box</span>
                <span className="num ev-card-share">{pct(t.share)}</span>
              </li>
            ))}
          </ol>
        </section>

        <p className="note">
          How it&apos;s worked out: each pack layout and card slot is weighted by the published print odds (from{" "}
          <a href="https://github.com/taw/magic-sealed-data" target="_blank" rel="noopener noreferrer">
            magic-sealed-data
          </a>
          , the source MTGJSON uses), and each card is priced at its Cardmarket trend price from Scryfall.{" "}
          {base.unpriced > 0.005 ? `${pct(base.unpriced)} of the cards in a pack have no price and count as €0${base.unpriced >= 0.1 ? ", so the real value is likely higher than shown" : ""}. ` : ""}
          Trend prices aren&apos;t offers: selling a lot of one card at once usually gets less, and postage isn&apos;t included. The average is not a promise: most boxes come out below it.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
