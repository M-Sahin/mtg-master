#!/usr/bin/env python3
"""Validate a Magic decklist (stdlib only).

Usage:
  deckcheck.py deck.txt --format pioneer
  deckcheck.py deck.txt --format commander --commander "Atraxa, Praetors' Voice"
  cat deck.txt | deckcheck.py - --format limited
  deckcheck.py deck.txt --format modern --offline     # structural checks only

Accepts Arena ("Deck"/"Sideboard"/"Commander"/"Companion" headers, "4 Name (SET) 123"),
MTGO (blank line before sideboard), "4x Name", and "SB: 2 Name" styles.

Checks: card counts, sideboard size, copy limits / singleton, and — when Scryfall is
reachable — that every card exists, is legal (or not restricted beyond 1 copy) in the
format, commander color identity, plus a mana-curve and type summary.
Exit code 0 = no errors, 1 = errors found, 2 = bad input.
"""
import argparse
import os
import re
import sys
from collections import Counter, OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASICS = {"plains", "island", "swamp", "mountain", "forest", "wastes",
          "snow-covered plains", "snow-covered island", "snow-covered swamp",
          "snow-covered mountain", "snow-covered forest", "snow-covered wastes"}
# Offline fallback for "a deck can have any number of cards named ..." (online check uses oracle text)
ANY_NUMBER_OFFLINE = {"relentless rats", "shadowborn apostle", "persistent petitioners", "rat colony",
                      "dragon's approach", "slime against humanity", "hare apparent", "templar knight",
                      "tempest hawk", "cid, timeless artificer"}
LIMITED_COPIES = {"seven dwarves": 7, "nazgûl": 9, "nazgul": 9}

FORMATS = {
    # name: (min_main, exact_main, max_sideboard, max_copies)  None = no limit
    "standard": (60, None, 15, 4), "pioneer": (60, None, 15, 4), "modern": (60, None, 15, 4),
    "legacy": (60, None, 15, 4), "vintage": (60, None, 15, 4), "pauper": (60, None, 15, 4),
    "historic": (60, None, 15, 4), "explorer": (60, None, 15, 4), "timeless": (60, None, 15, 4),
    "alchemy": (60, None, 15, 4), "premodern": (60, None, 15, 4), "oldschool": (60, None, 15, 4),
    "commander": (100, 100, None, 1), "duel": (100, 100, None, 1), "paupercommander": (100, 100, None, 1),
    "brawl": (100, 100, None, 1), "standardbrawl": (60, 60, None, 1), "oathbreaker": (60, 60, None, 1),
    "limited": (40, None, None, None),
}
SECTION_WORDS = {"deck": "main", "main": "main", "mainboard": "main", "main deck": "main",
                 "sideboard": "side", "side": "side", "companion": "side",
                 "commander": "commander", "commanders": "commander",
                 "maybeboard": "ignore", "maybe": "ignore", "considering": "ignore", "tokens": "ignore"}
ALIASES = {"edh": "commander", "cedh": "commander", "pdh": "paupercommander", "pauperedh": "paupercommander",
           "duelcommander": "duel", "frenchcommander": "duel", "historicbrawl": "brawl", "draft": "limited",
           "sealed": "limited", "cube": "limited"}
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}
LINE = re.compile(r"^(?:(SB:)\s*)?(\d+)\s*x?\s+(.+?)\s*$", re.I)


def clean_name(n):
    n = re.sub(r"\s*\*[A-Z]+\*\s*", " ", n)        # *F* foil markers
    n = re.sub(r"\s*#\S+", "", n)                   # #tags
    n = re.sub(r"\s*\[[^\]]*\]\s*$", "", n)          # [category]
    n = re.sub(r"\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?\s*$", "", n)  # (SET) 123
    n = n.replace(" / ", " // ")
    return n.strip()


def parse(text, fmt, notes=None):
    """Return (sections, unparsed_lines). `notes` (a list) receives parser notes.

    Header-less lists (MTGO / plain text): only the LAST blank-line-separated block is
    treated as the sideboard, and only if it is no bigger than a legal sideboard. This
    keeps lists that separate creatures / spells / lands with blank lines intact.
    """
    sections = {"main": OrderedDict(), "side": OrderedDict(), "commander": OrderedDict()}
    current, saw_header = "main", False
    max_sb = FORMATS.get(fmt, (0, 0, None))[2]
    constructed = FORMATS.get(fmt, (60,))[0] == 60 and max_sb == 15
    blocks, block = [], []          # header-less entries grouped by blank lines
    bad = []

    def add(target, name, qty):
        d = sections[target]
        d[name] = d.get(name, 0) + qty

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            if block:
                blocks.append(block)
                block = []
            continue
        if line.startswith("//") or line.lower().startswith(("about", "name ")):
            continue
        if re.match(r"^[A-Za-z ]+\(\d+\)$", line):  # "Creatures (24)" group labels from exports
            continue
        key = line.rstrip(":").lower()
        if key in SECTION_WORDS:
            current, saw_header = SECTION_WORDS[key], True
            continue
        m = LINE.match(line)
        if not m:
            bad.append(line)
            continue
        sb, qty, name = m.group(1), int(m.group(2)), clean_name(m.group(3))
        if sb:
            add("side", name, qty)
        elif saw_header:
            if current != "ignore":
                add(current, name, qty)
        else:
            block.append((name, qty))
    if block:
        blocks.append(block)

    # Header-less cards (if a header appeared later, these came before it -> main deck)
    side_block = None
    if not saw_header and constructed and len(blocks) > 1:
        last_n = sum(q for _, q in blocks[-1])
        if last_n <= max_sb:
            side_block = blocks[-1]
            if notes is not None:
                notes.append(f"No section headers: treated the last blank-line-separated block ({last_n} cards) "
                             "as the sideboard (MTGO style). Add 'Deck'/'Sideboard' headers if that's wrong.")
    for b in blocks:
        for name, qty in b:
            add("side" if b is side_block else "main", name, qty)
    return sections, bad


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", help="decklist file, or - for stdin")
    ap.add_argument("--format", "-f", default="standard", help="|".join(FORMATS))
    ap.add_argument("--commander", action="append", default=[], help="commander name (repeat for partners)")
    ap.add_argument("--offline", action="store_true", help="skip Scryfall checks")
    a = ap.parse_args()
    fmt = a.format.lower().replace(" ", "").replace("-", "")
    fmt = ALIASES.get(fmt, fmt)
    if fmt not in FORMATS:
        print(f"Unknown format '{a.format}'. Known: {', '.join(FORMATS)}"); sys.exit(2)
    try:
        text = sys.stdin.read() if a.file == "-" else open(a.file, encoding="utf-8-sig").read()
    except (OSError, UnicodeDecodeError) as e:
        print(f"Can't read decklist: {e}"); sys.exit(2)
    errors, warnings = [], []
    secs, bad = parse(text, fmt, warnings)
    min_main, exact, max_sb, max_copies = FORMATS[fmt]
    singleton = max_copies == 1

    for c in a.commander:
        name = clean_name(c)
        for sec in ("main", "commander"):
            for k in [k for k in secs[sec] if k.lower() == name.lower()]:
                if sec == "main" and secs[sec][k] > 1:
                    secs[sec][k] -= 1
                else:
                    secs[sec].pop(k)
        secs["commander"][name] = 1
    if bad:
        warnings.append("Unparsed lines: " + " | ".join(bad[:10]))

    main_n = sum(secs["main"].values())
    cmd_n = sum(secs["commander"].values())
    side_n = sum(secs["side"].values())
    if singleton:
        total = main_n + cmd_n
        if cmd_n == 0:
            warnings.append("No commander identified — use a 'Commander' header or --commander.")
        if exact and total != exact:
            errors.append(f"Deck has {total} cards including commander(s) ({cmd_n}); {fmt} needs exactly {exact}.")
    else:
        if main_n < min_main:
            errors.append(f"Main deck has {main_n} cards; {fmt} needs at least {min_main}.")
        if max_sb is not None and side_n > max_sb:
            errors.append(f"Sideboard has {side_n} cards; max is {max_sb}.")

    # copy limits (combined main + side for constructed)
    combined = Counter()
    for s in ("main", "side", "commander"):
        for n, q in secs[s].items():
            combined[n] += q

    cards = {}
    online = False
    if not a.offline:
        try:
            import scryfall
            cards, missing = scryfall.get_cards(list(combined))
            online = True
            for m in missing:
                errors.append(f"Card not found on Scryfall (typo or nonexistent?): {m}")
        except Exception as e:
            warnings.append(f"Scryfall unreachable ({e}); ran structural checks only. Verify legality via the fallback in references/lookup.md.")

    def card_for(n):
        return cards.get(n.lower())

    def any_number(n):
        c = card_for(n)
        if c:
            txt = (c.get("oracle_text") or "") + " ".join(f.get("oracle_text", "") for f in c.get("card_faces", []) or [])
            if "any number of cards named" in txt:
                return None
            m = re.search(r"up to (\w+) cards named", txt)
            if m:
                w = m.group(1).lower()
                return int(w) if w.isdigit() else NUMBER_WORDS.get(w, max_copies)
            return False
        if n.lower() in ANY_NUMBER_OFFLINE:
            return None
        return LIMITED_COPIES.get(n.lower(), False)

    if max_copies is not None:
        for n, q in combined.items():
            if n.lower() in BASICS:
                continue
            exc = any_number(n)
            limit = max_copies if exc is False else exc
            if limit is not None and q > limit:
                errors.append(f"{q} copies of {n} (limit {limit}).")

    if online:
        # Scryfall's legality keys match these format names (duel = Duel Commander's own list)
        legal_key = None if fmt == "limited" else fmt
        if legal_key and cards and not any(legal_key in c.get("legalities", {}) for c in cards.values()):
            warnings.append(f"Scryfall has no '{legal_key}' legality data; legality NOT checked — verify manually.")
        for n in combined:
            c = card_for(n)
            if not c or not legal_key:
                continue
            st = c.get("legalities", {}).get(legal_key)
            if st is None:
                continue
            if st == "banned":
                errors.append(f"{c['name']} is BANNED in {legal_key}.")
            elif st == "not_legal":
                errors.append(f"{c['name']} is not legal in {legal_key}.")
            elif st == "restricted" and combined[n] > 1:
                errors.append(f"{c['name']} is restricted in {legal_key} (max 1).")
        if singleton and secs["commander"]:
            ident = set()
            for n in secs["commander"]:
                c = card_for(n)
                if c:
                    ident |= set(c.get("color_identity", []))
                    front = c.get("type_line", "").split("//")[0]
                    text = (c.get("oracle_text") or "") + " ".join(f.get("oracle_text", "") for f in c.get("card_faces", []) or [])
                    ok = "can be your commander" in text or ("Legendary" in front and "Creature" in front)
                    if fmt in ("brawl", "standardbrawl"):
                        ok = ok or ("Legendary" in front and "Planeswalker" in front)
                    if fmt == "oathbreaker":
                        ok = any(t in front for t in ("Planeswalker", "Instant", "Sorcery"))  # oathbreaker + signature spell
                    if fmt != "paupercommander" and not ok:
                        warnings.append(f"{c['name']} doesn't look like a legal commander for {fmt} ({front.strip()}).")
            for n in secs["main"]:
                c = card_for(n)
                if c and not set(c.get("color_identity", [])) <= ident:
                    errors.append(f"{c['name']} ({''.join(c['color_identity'])}) is outside commander color identity ({''.join(sorted(ident)) or 'C'}).")

    # report
    print(f"Format: {fmt}")
    if secs["commander"]:
        print("Commander: " + ", ".join(secs["commander"]))
    print(f"Main: {main_n}" + (f"  Sideboard: {side_n}" if not singleton else f"  Total incl. commander: {main_n + cmd_n}"))
    if online:
        lands = sum(q for n, q in secs["main"].items() if card_for(n) and "Land" in card_for(n).get("type_line", "").split("//")[0])
        curve = Counter()
        types = Counter()
        for n, q in secs["main"].items():
            c = card_for(n)
            if not c:
                continue
            tl = c.get("type_line", "").split("//")[0]
            if "Land" in tl:
                continue
            curve[min(int(c.get("cmc", 0)), 7)] += q
            for t in ("Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle"):
                if t in tl:
                    types[t] += q
                    break
        nonland = sum(curve.values())
        avg = sum(k * v for k, v in curve.items()) / nonland if nonland else 0
        print(f"Lands: {lands}  Nonland: {nonland}  Avg MV (nonland): {avg:.2f}")
        print("Curve: " + "  ".join(f"{k if k < 7 else '7+'}:{curve[k]}" for k in range(0, 8) if curve[k]))
        print("Types: " + ", ".join(f"{t} {q}" for t, q in types.most_common()))
    for w in warnings:
        print("WARNING:", w)
    for e in errors:
        print("ERROR:", e)
    if not errors:
        print("OK: no errors found" + ("" if online else " (structural checks only)"))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
