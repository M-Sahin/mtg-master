#!/usr/bin/env python3
"""Minimal Scryfall client for the mtg-master skill (stdlib only).

Usage:
  scryfall.py card "Lightning Bolt"            # exact name, falls back to fuzzy
  scryfall.py cards "Card A" "Card B" ...      # batch lookup (up to 75 per request, auto-chunked)
  scryfall.py search "f:pioneer c:b otag:removal mv<=2" [--order edhrec] [--limit 20]
  scryfall.py rulings "Card Name"
  scryfall.py sets [--limit 15]                # newest sets first
  Add --json to any command for raw JSON.

Needs network access to api.scryfall.com. If it is blocked, the command exits with
code 2 and says so; use the web-search fallback in references/lookup.md instead.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.scryfall.com"
HEADERS = {"User-Agent": "mtg-master-skill/1.0", "Accept": "application/json"}
_last = [0.0]


class NetworkBlocked(Exception):
    pass


def _request(path, data=None):
    wait = 0.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    url = path if path.startswith("http") else API + path
    body = None
    headers = dict(HEADERS)
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            _last[0] = time.time()
            return json.load(r)
    except urllib.error.HTTPError as e:
        _last[0] = time.time()
        try:
            return json.load(e)
        except Exception:
            raise NetworkBlocked(f"HTTP {e.code} from {url}")
    except (urllib.error.URLError, OSError) as e:
        raise NetworkBlocked(str(e))


def get_card(name):
    q = urllib.parse.quote(name)
    card = _request(f"/cards/named?exact={q}")
    if card.get("object") == "error":
        card = _request(f"/cards/named?fuzzy={q}")
    return card


def get_cards(names):
    """Batch lookup. Returns (found: dict lower-name -> card, not_found: list)."""
    found, missing = {}, []
    names = list(dict.fromkeys(names))
    for i in range(0, len(names), 75):
        chunk = names[i:i + 75]
        res = _request("/cards/collection", {"identifiers": [{"name": n} for n in chunk]})
        if res.get("object") == "error":
            raise NetworkBlocked(res.get("details", "collection error"))
        for c in res.get("data", []):
            found[c["name"].lower()] = c
            # map each face name too, so "Front Face" matches "Front // Back"
            for f in c.get("card_faces", []) or []:
                found.setdefault(f["name"].lower(), c)
        for nf in res.get("not_found", []):
            missing.append(nf.get("name", str(nf)))
    return found, missing


def search(query, order=None, limit=25, unique="cards"):
    params = {"q": query, "unique": unique}
    if order:
        params["order"] = order
    url = "/cards/search?" + urllib.parse.urlencode(params)
    out = []
    while url and len(out) < limit:
        res = _request(url)
        if res.get("object") == "error":
            return res, []
        out.extend(res.get("data", []))
        url = res.get("next_page") if res.get("has_more") else None
    return res, out[:limit]


def oracle(card):
    if card.get("oracle_text") is not None and not card.get("card_faces"):
        return card["oracle_text"]
    faces = card.get("card_faces") or []
    if faces:
        parts = []
        for f in faces:
            pt = f" {f['power']}/{f['toughness']}" if "power" in f else ""
            parts.append(f"[{f['name']}] {f.get('mana_cost','')} — {f.get('type_line','')}{pt}\n{f.get('oracle_text','')}")
        return "\n".join(parts)
    return card.get("oracle_text", "")


def fmt_card(c, legal=True):
    if c.get("object") == "error":
        return f"ERROR: {c.get('details')}"
    lines = [f"{c['name']}  {c.get('mana_cost','')}  (MV {c.get('cmc', 0):g})", c.get("type_line", "")]
    if "power" in c:
        lines.append(f"P/T: {c['power']}/{c['toughness']}")
    if "loyalty" in c:
        lines.append(f"Loyalty: {c['loyalty']}")
    lines.append(oracle(c))
    lines.append(f"Color identity: {''.join(c.get('color_identity', [])) or 'colorless'}  |  Rarity: {c.get('rarity')}  |  First/this printing: {c.get('set_name')} ({c.get('released_at')})")
    if c.get("game_changer"):
        lines.append("Commander Game Changer: yes")
    if legal:
        leg = c.get("legalities", {})
        keys = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "commander", "brawl", "standardbrawl", "historic", "timeless", "alchemy", "explorer"]
        lines.append("Legality: " + ", ".join(f"{k}={leg[k]}" for k in keys if k in leg))
    p = c.get("prices", {})
    lines.append(f"Prices: usd={p.get('usd')} usd_foil={p.get('usd_foil')} eur={p.get('eur')} tix={p.get('tix')}")
    lines.append(f"Scryfall: {c.get('scryfall_uri','').split('?')[0]}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="print raw JSON")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("card"); p.add_argument("name")
    p = sub.add_parser("cards"); p.add_argument("names", nargs="+")
    p = sub.add_parser("search"); p.add_argument("query"); p.add_argument("--order"); p.add_argument("--limit", type=int, default=25); p.add_argument("--unique", default="cards")
    p = sub.add_parser("rulings"); p.add_argument("name")
    p = sub.add_parser("sets"); p.add_argument("--limit", type=int, default=15)
    a = ap.parse_args()

    try:
        if a.cmd == "card":
            c = get_card(a.name)
            print(json.dumps(c, indent=1) if a.json else fmt_card(c))
        elif a.cmd == "cards":
            found, missing = get_cards(a.names)
            if a.json:
                print(json.dumps({"found": list({id(v): v for v in found.values()}.values()), "not_found": missing}, indent=1))
            else:
                seen = set()
                for n in a.names:
                    c = found.get(n.lower())
                    if c and c["id"] not in seen:
                        seen.add(c["id"])
                        print(fmt_card(c), end="\n\n")
                if missing:
                    print("NOT FOUND (check spelling / may not exist):", "; ".join(missing))
        elif a.cmd == "search":
            res, cards = search(a.query, a.order, a.limit, a.unique)
            if res.get("object") == "error":
                print("ERROR:", res.get("details")); sys.exit(1)
            if a.json:
                print(json.dumps(cards, indent=1))
            else:
                print(f"{res.get('total_cards', len(cards))} total matches; showing {len(cards)}")
                for c in cards:
                    print(f"- {c['name']} {c.get('mana_cost','') or ''} — {c.get('type_line','')} | ${c.get('prices',{}).get('usd')}")
        elif a.cmd == "rulings":
            c = get_card(a.name)
            if c.get("object") == "error":
                print("ERROR:", c.get("details")); sys.exit(1)
            r = _request(c["rulings_uri"])
            if a.json:
                print(json.dumps(r, indent=1))
            else:
                print(f"Rulings for {c['name']}:")
                for x in r.get("data", []):
                    print(f"- ({x['published_at']}, {x['source']}) {x['comment']}")
                if not r.get("data"):
                    print("(none)")
        elif a.cmd == "sets":
            r = _request("/sets")
            sets = [s for s in r.get("data", []) if s.get("set_type") in ("expansion", "core", "draft_innovation", "masters", "commander", "alchemy", "funny")]
            today = time.strftime("%Y-%m-%d")
            for s in sets[: a.limit]:
                tag = " (upcoming)" if s.get("released_at", "") > today else ""
                print(f"{s.get('released_at')}  {s['code'].upper():6} {s['name']}  [{s['set_type']}]{tag}")
    except NetworkBlocked as e:
        print(f"NETWORK BLOCKED: cannot reach Scryfall ({e}). Use the web-search fallback in references/lookup.md.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
