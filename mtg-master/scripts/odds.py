#!/usr/bin/env python3
"""Draw probabilities for Magic (hypergeometric, stdlib only).

Cards seen by a turn: opening 7 plus one per draw step (none on turn 1 on the play).

Examples:
  # P(at least 1 of my 4 copies in opening hand), 60-card deck
  odds.py hit --deck 60 --copies 4 --seen 7
  # P(at least 1 copy by turn 3 on the draw)
  odds.py turn --deck 60 --copies 4 --turn 3 --draw
  # P(enough colored sources to cast a 1CC spell on turn 3 with 18 sources), 60 cards, on the play
  # add --lands 24 for the Karsten-style figure (assumes you hit your land drops)
  odds.py sources --deck 60 --sources 18 --pips 2 --turn 3 --lands 24
  # P(at least 2 lands and at most 4 in opening 7) with 24 lands
  odds.py range --deck 60 --copies 24 --seen 7 --min 2 --max 4
  # Combo: P(at least 1 of group A (4 cards) AND 1 of group B (3 cards)) by turn 4 on the play
  odds.py combo --deck 60 --groups 4 3 --turn 4
  # How many copies do I need for >=90% to see one by turn 2?
  odds.py need --deck 60 --turn 2 --target 0.9
"""
import argparse
from itertools import product
from math import comb


def pmf(N, K, n, k):
    if k < 0 or k > K or n - k > N - K or n > N:
        return 0.0
    return comb(K, k) * comb(N - K, n - k) / comb(N, n)


def at_least(N, K, n, k):
    return sum(pmf(N, K, n, i) for i in range(k, min(K, n) + 1))


def seen_by(turn, draw):
    return 7 + (turn if draw else turn - 1)


def combo(N, groups, n, need=None):
    """P(at least need[i] from each group). Multivariate hypergeometric by enumeration."""
    need = need or [1] * len(groups)
    rest = N - sum(groups)
    total = comb(N, n)
    p = 0
    ranges = [range(r, min(g, n) + 1) for g, r in zip(groups, need)]
    for ks in product(*ranges):
        s = sum(ks)
        if s > n or n - s > rest:
            continue
        ways = comb(rest, n - s)
        for g, k in zip(groups, ks):
            ways *= comb(g, k)
        p += ways
    return p / total


def sources_given_lands(N, L, S, n, pips, min_lands):
    """P(>= pips colored sources | >= min_lands lands among n cards seen).

    L lands in the deck, S of them produce the color (S <= L). This is how Frank Karsten
    counts: it assumes you hit your land drops, so it isolates color screw from mana screw.
    """
    hit = base = 0.0
    for l in range(min_lands, min(L, n) + 1):
        p_l = pmf(N, L, n, l)
        base += p_l
        hit += p_l * at_least(L, S, l, pips)
    return hit / base if base else 0.0


def pct(x):
    return f"{100 * x:.1f}%"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, copies=True):
        p.add_argument("--deck", type=int, default=60)
        if copies:
            p.add_argument("--copies", type=int, required=True)
        g = p.add_mutually_exclusive_group()
        g.add_argument("--seen", type=int, help="number of cards seen")
        g.add_argument("--turn", type=int, help="turn number (uses play/draw)")
        p.add_argument("--draw", action="store_true", help="on the draw (default: on the play)")

    p = sub.add_parser("hit", help="P(at least --atleast copies)"); common(p); p.add_argument("--atleast", type=int, default=1)
    p = sub.add_parser("turn", help="P(at least one by turn N)"); common(p); p.add_argument("--atleast", type=int, default=1)
    p = sub.add_parser("range", help="P(min <= copies seen <= max)"); common(p); p.add_argument("--min", type=int, default=0); p.add_argument("--max", type=int, default=99)
    p = sub.add_parser("sources", help="P(at least --pips colored sources by turn)"); common(p, copies=False)
    p.add_argument("--sources", type=int, required=True); p.add_argument("--pips", type=int, default=1)
    p.add_argument("--lands", type=int, help="total lands in the deck: also report Karsten-style odds, assuming you hit your land drops")
    p.add_argument("--mv", type=int, help="mana value of the spell (lands you need; default: the turn number)")
    p = sub.add_parser("combo", help="P(at least one from each group)"); common(p, copies=False)
    p.add_argument("--groups", type=int, nargs="+", required=True); p.add_argument("--need", type=int, nargs="+")
    p = sub.add_parser("need", help="copies needed to hit target probability"); common(p, copies=False)
    p.add_argument("--target", type=float, default=0.9); p.add_argument("--atleast", type=int, default=1)

    a = ap.parse_args()
    if a.deck < 1:
        ap.error("--deck must be at least 1")
    if a.turn is not None and a.turn < 1:
        ap.error("--turn must be 1 or higher")
    if a.seen is not None and a.seen < 0:
        ap.error("--seen cannot be negative")
    n = a.seen if a.seen is not None else seen_by(a.turn or 1, a.draw)
    if n > a.deck:
        ap.error(f"{n} cards seen is more than the {a.deck}-card deck")
    for attr in ("copies", "sources"):
        v = getattr(a, attr, None)
        if v is not None and not 0 <= v <= a.deck:
            ap.error(f"--{attr} must be between 0 and the deck size ({a.deck})")
    if a.cmd == "combo":
        if any(g < 0 for g in a.groups) or sum(a.groups) > a.deck:
            ap.error(f"--groups must be non-negative and add up to at most the deck size ({a.deck})")
        if a.need is not None and len(a.need) != len(a.groups):
            ap.error(f"--need has {len(a.need)} values but --groups has {len(a.groups)}; give one per group")
    if a.cmd == "need" and not 0 < a.target <= 1:
        ap.error("--target is a probability between 0 and 1 (e.g. 0.9)")
    when = f"{n} cards seen" + (f" (turn {a.turn} on the {'draw' if a.draw else 'play'})" if a.turn else "")

    if a.cmd in ("hit", "turn"):
        print(f"P(>= {a.atleast} of {a.copies} in {a.deck}-card deck, {when}) = {pct(at_least(a.deck, a.copies, n, a.atleast))}")
    elif a.cmd == "range":
        p = sum(pmf(a.deck, a.copies, n, k) for k in range(a.min, min(a.max, n) + 1))
        print(f"P({a.min} <= x <= {a.max} of {a.copies}, {when}) = {pct(p)}")
        for k in range(0, min(a.copies, n) + 1):
            v = pmf(a.deck, a.copies, n, k)
            if v >= 0.0005:
                print(f"  exactly {k}: {pct(v)}")
    elif a.cmd == "sources":
        p = at_least(a.deck, a.sources, n, a.pips)
        print(f"P(>= {a.pips} sources among {a.sources}, {when}) = {pct(p)}  [unconditional: includes mana screw]")
        if a.lands is not None:
            if not a.sources <= a.lands <= a.deck:
                ap.error("--lands must be at least --sources and at most --deck")
            need = a.mv if a.mv is not None else (a.turn or 1)
            pc = sources_given_lands(a.deck, a.lands, a.sources, n, a.pips, need)
            print(f"P(>= {a.pips} sources | >= {need} of {a.lands} lands seen) = {pct(pc)}  [Karsten-style: color screw only]")
        else:
            print("  Karsten's tables assume you hit your land drops and read noticeably higher;"
                  " add --lands <total lands> to get that number.")
    elif a.cmd == "combo":
        p = combo(a.deck, a.groups, n, a.need)
        print(f"P(each group {a.groups} hit {a.need or [1]*len(a.groups)}, {when}) = {pct(p)}")
    elif a.cmd == "need":
        for k in range(1, a.deck + 1):
            if at_least(a.deck, k, n, a.atleast) >= a.target:
                print(f"Need {k} copies for >= {pct(a.target)} to see {a.atleast}+ ({when}); gives {pct(at_least(a.deck, k, n, a.atleast))}")
                break
        else:
            print(f"Not reachable: even {a.deck} copies can't give {a.atleast}+ with {n} cards seen.")


if __name__ == "__main__":
    main()
