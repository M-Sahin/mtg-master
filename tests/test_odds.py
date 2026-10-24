import itertools
import random
import unittest
from math import comb

from helpers import run_main
import odds


def brute_at_least(N, K, n, k):
    """Independent check: 1 - P(fewer than k), from the complement."""
    return 1 - sum(comb(K, i) * comb(N - K, n - i) for i in range(0, k) if n - i >= 0) / comb(N, n)


class OddsMath(unittest.TestCase):
    def test_known_values(self):
        # Reference values computed independently with scipy.stats.hypergeom.sf
        self.assertAlmostEqual(odds.at_least(60, 4, 7, 1), 0.3994996257, places=9)   # 4-of in opening hand
        self.assertAlmostEqual(odds.at_least(60, 4, 10, 1), 0.5277205287, places=9)  # 4-of by turn 3 on the draw
        self.assertAlmostEqual(odds.at_least(40, 17, 7, 2), 0.8948024948, places=9)  # 2+ lands, 17-land limited hand

    def test_pmf_sums_to_one(self):
        for N, K, n in [(60, 24, 7), (40, 17, 9), (99, 36, 10), (60, 0, 7), (60, 60, 7)]:
            self.assertAlmostEqual(sum(odds.pmf(N, K, n, k) for k in range(n + 1)), 1.0, places=12)

    def test_at_least_matches_complement(self):
        for N, K, n, k in [(60, 4, 7, 1), (60, 18, 9, 2), (99, 10, 12, 3), (40, 9, 8, 1)]:
            self.assertAlmostEqual(odds.at_least(N, K, n, k), brute_at_least(N, K, n, k), places=12)

    def test_seen_by(self):
        self.assertEqual(odds.seen_by(1, draw=False), 7)
        self.assertEqual(odds.seen_by(1, draw=True), 8)
        self.assertEqual(odds.seen_by(3, draw=False), 9)
        self.assertEqual(odds.seen_by(3, draw=True), 10)

    def test_combo_exact_small_deck(self):
        # Enumerate every hand of a tiny deck and compare with the formula.
        deck = ["A"] * 3 + ["B"] * 2 + ["x"] * 7
        hands = list(itertools.combinations(range(len(deck)), 5))
        hit = sum(1 for h in hands if sum(deck[i] == "A" for i in h) >= 1 and sum(deck[i] == "B" for i in h) >= 1)
        self.assertAlmostEqual(odds.combo(12, [3, 2], 5), hit / len(hands), places=12)
        hit2 = sum(1 for h in hands if sum(deck[i] == "A" for i in h) >= 2 and sum(deck[i] == "B" for i in h) >= 1)
        self.assertAlmostEqual(odds.combo(12, [3, 2], 5, [2, 1]), hit2 / len(hands), places=12)

    def test_sources_given_lands_exact_small_deck(self):
        # 3 colored lands + 2 other lands + 5 spells; 4 cards seen; condition: >= 2 lands
        deck = ["S"] * 3 + ["L"] * 2 + ["x"] * 5
        ok = base = 0
        for h in itertools.combinations(range(10), 4):
            c = [deck[i] for i in h]
            if c.count("S") + c.count("L") >= 2:
                base += 1
                ok += c.count("S") >= 2
        self.assertAlmostEqual(odds.sources_given_lands(10, 5, 3, 4, 2, 2), ok / base, places=12)

    def test_karsten_style_near_his_targets(self):
        # Karsten's 60-card table aims at roughly 90%; the conditional figure should land near it
        for S, pips, turn in [(14, 1, 1), (13, 1, 2), (21, 2, 2), (18, 2, 3), (23, 3, 3)]:
            p = odds.sources_given_lands(60, 24, S, odds.seen_by(turn, False), pips, turn)
            self.assertTrue(0.86 <= p <= 0.97, (S, pips, turn, p))

    def test_combo_monte_carlo_60(self):
        rng = random.Random(1)
        deck = ["A"] * 4 + ["B"] * 3 + ["x"] * 53
        trials, hit = 100_000, 0
        for _ in range(trials):
            h = rng.sample(deck, 10)
            hit += ("A" in h) and ("B" in h)
        self.assertAlmostEqual(odds.combo(60, [4, 3], 10), hit / trials, delta=0.006)


class OddsCli(unittest.TestCase):
    def test_docstring_examples_run(self):
        for argv, expect in [
            (["hit", "--deck", "60", "--copies", "4", "--seen", "7"], "39.9%"),
            (["turn", "--deck", "60", "--copies", "4", "--turn", "3", "--draw"], "52.8%"),
            (["sources", "--deck", "60", "--sources", "18", "--pips", "2", "--turn", "3"], "82.6%"),
            (["range", "--deck", "60", "--copies", "24", "--seen", "7", "--min", "2", "--max", "4"], "77.5%"),
            (["combo", "--deck", "60", "--groups", "4", "3", "--turn", "4"], "21.4%"),
            (["need", "--deck", "60", "--turn", "2", "--target", "0.9"], "Need 15 copies"),
            (["sources", "--sources", "18", "--pips", "2", "--turn", "3", "--lands", "24"], "93.8%"),
        ]:
            code, out = run_main(odds, argv)
            self.assertEqual(code, 0, out)
            self.assertIn(expect, out, argv)

    def test_rejects_bad_input(self):
        for argv in [
            ["combo", "--groups", "4", "3", "2", "--need", "1", "1"],  # previously gave a silently wrong answer
            ["hit", "--deck", "60", "--copies", "70"],
            ["hit", "--deck", "60", "--copies", "4", "--seen", "70"],
            ["combo", "--deck", "60", "--groups", "40", "30"],
            ["need", "--target", "1.5"],
            ["turn", "--copies", "4", "--turn", "0"],
            ["sources", "--sources", "18", "--lands", "10", "--turn", "3"],
        ]:
            code, out = run_main(odds, argv)
            self.assertEqual(code, 2, f"{argv} should be rejected, got: {out}")

    def test_need_unreachable(self):
        code, out = run_main(odds, ["need", "--deck", "60", "--seen", "7", "--atleast", "8"])
        self.assertEqual(code, 0)
        self.assertIn("Not reachable", out)


if __name__ == "__main__":
    unittest.main()
