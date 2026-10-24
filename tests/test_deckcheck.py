import os
import tempfile
import unittest

from helpers import blocked_request, run_main
import deckcheck


def check(deck, *args, request=None):
    kw = {"stdin": deck}
    if request is not None:
        kw["request"] = request
    return run_main(deckcheck, ["-", *args], **kw)


ARENA = """About
Name Mono Red

Deck
4 Monastery Swiftspear (BRO) 144
4 Lightning Bolt (2X2) 117
4 Kumano Faces Kakkazan // Etching of Kumano
28 Mountain
4 Seven Dwarves
4 Counterspell
4 Llanowar Elves
4 Relentless Rats
4 Black Lotus

Sideboard
3 Seven Dwarves
"""


class Parsing(unittest.TestCase):
    def parse(self, text, fmt="modern"):
        notes = []
        secs, bad = deckcheck.parse(text, fmt, notes)
        return secs, bad, notes

    def test_arena_headers_and_set_codes(self):
        secs, bad, _ = self.parse(ARENA)
        self.assertEqual(sum(secs["main"].values()), 60)
        self.assertEqual(secs["side"], {"Seven Dwarves": 3})
        self.assertIn("Monastery Swiftspear", secs["main"])
        self.assertIn("Lightning Bolt", secs["main"])
        self.assertEqual(bad, [])

    def test_line_styles(self):
        secs, bad, _ = self.parse("4x Lightning Bolt\n2 Fire / Ice\n1 Sol Ring (C21) 263 *F*\nSB: 2 Counterspell\n")
        self.assertEqual(secs["main"], {"Lightning Bolt": 4, "Fire // Ice": 2, "Sol Ring": 1})
        self.assertEqual(secs["side"], {"Counterspell": 2})

    def test_mtgo_blank_line_sideboard(self):
        secs, _, notes = self.parse("4 Lightning Bolt\n56 Mountain\n\n3 Counterspell\n")
        self.assertEqual(sum(secs["main"].values()), 60)
        self.assertEqual(secs["side"], {"Counterspell": 3})
        self.assertTrue(notes)  # tells the user which block it assumed was the sideboard

    def test_blank_lines_between_groups_stay_main(self):
        # Previously everything after the first blank line became the "sideboard".
        text = "4 Monastery Swiftspear\n\n4 Lightning Bolt\n4 Counterspell\n\n24 Mountain\n24 Forest\n"
        secs, _, _ = self.parse(text)
        self.assertEqual(sum(secs["main"].values()), 60)
        self.assertEqual(sum(secs["side"].values()), 0)

    def test_grouped_list_with_mtgo_sideboard(self):
        text = "Creatures (4)\n4 Monastery Swiftspear\n\nLands (56)\n56 Mountain\n\n2 Counterspell\n"
        secs, bad, _ = self.parse(text)
        self.assertEqual(sum(secs["main"].values()), 60)
        self.assertEqual(secs["side"], {"Counterspell": 2})
        self.assertEqual(bad, [])

    def test_maybeboard_ignored(self):
        secs, _, _ = self.parse("Deck\n60 Mountain\nMaybeboard\n4 Lightning Bolt\n")
        self.assertNotIn("Lightning Bolt", secs["main"])
        self.assertNotIn("Lightning Bolt", secs["side"])


class Offline(unittest.TestCase):
    def test_copy_limit_counts_main_plus_side(self):
        code, out = check("4 Lightning Bolt\n56 Mountain\nSideboard\n1 Lightning Bolt\n", "-f", "modern", "--offline")
        self.assertEqual(code, 1)
        self.assertIn("5 copies of Lightning Bolt (limit 4)", out)

    def test_basics_unlimited_and_any_number_offline(self):
        code, out = check("40 Mountain\n20 Relentless Rats\n", "-f", "modern", "--offline")
        self.assertEqual(code, 0, out)
        self.assertIn("structural checks only", out)

    def test_main_too_small_and_sideboard_too_big(self):
        code, out = check("Deck\n59 Mountain\nSideboard\n16 Forest\n", "-f", "pioneer", "--offline")
        self.assertIn("needs at least 60", out)
        self.assertIn("max is 15", out)
        self.assertEqual(code, 1)

    def test_commander_count_and_singleton(self):
        deck = "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Sol Ring\n97 Forest\n"
        code, out = check(deck, "-f", "commander", "--offline")
        self.assertEqual(code, 1)
        self.assertIn("2 copies of Sol Ring (limit 1)", out)
        self.assertNotIn("needs exactly 100", out)  # 1 + 2 + 97 = 100, so only the singleton error
        code, out = check(deck.replace("97 Forest", "98 Forest"), "-f", "commander", "--offline")
        self.assertIn("Deck has 101 cards", out)

    def test_commander_flag_is_case_insensitive(self):
        deck = "1 atraxa, praetors' voice\n99 Forest\n"
        code, out = check(deck, "-f", "edh", "--commander", "Atraxa, Praetors' Voice", "--offline")
        self.assertEqual(code, 0, out)
        self.assertIn("Total incl. commander: 100", out)

    def test_limited_40(self):
        self.assertEqual(check("23 Mountain\n17 Forest\n", "-f", "draft", "--offline")[0], 0)
        self.assertEqual(check("39 Mountain\n", "-f", "limited", "--offline")[0], 1)

    def test_aliases_and_unknown_format(self):
        for alias in ("EDH", "cEDH", "pdh", "Duel Commander"):
            code, out = check("1 Atraxa, Praetors' Voice\n99 Forest\n", "-f", alias, "--offline")
            self.assertNotEqual(code, 2, f"{alias}: {out}")
        self.assertEqual(check("60 Mountain\n", "-f", "frontier", "--offline")[0], 2)

    def test_missing_file(self):
        code, out = run_main(deckcheck, [os.path.join(tempfile.gettempdir(), "does-not-exist.txt")])
        self.assertEqual(code, 2)
        self.assertIn("Can't read decklist", out)

    def test_scryfall_blocked_falls_back(self):
        code, out = check("4 Lightning Bolt\n56 Mountain\n", "-f", "modern", request=blocked_request)
        self.assertEqual(code, 0, out)
        self.assertIn("Scryfall unreachable", out)


class Online(unittest.TestCase):
    """Online code paths, with Scryfall answered from tests/fixtures/cards.json."""

    def test_legality_banned_restricted_and_curve(self):
        code, out = check(ARENA, "-f", "modern")
        self.assertEqual(code, 1)
        self.assertIn("Black Lotus is not legal in modern", out)
        self.assertIn("Counterspell is not legal in modern", out)
        self.assertNotIn("copies of Seven Dwarves", out)  # 4 main + 3 side = 7, the card's own limit
        self.assertNotIn("copies of Relentless Rats", out)
        self.assertIn("Lands: 28", out)
        self.assertIn("Curve:", out)

    def test_seven_dwarves_limit(self):
        code, out = check("8 Seven Dwarves\n52 Mountain\n", "-f", "modern")
        self.assertIn("8 copies of Seven Dwarves (limit 7)", out)
        self.assertEqual(code, 1)

    def test_banned_and_restricted(self):
        code, out = check("1 Oko, Thief of Crowns\n59 Forest\n", "-f", "modern")
        self.assertIn("BANNED in modern", out)
        code, out = check("2 Black Lotus\n58 Forest\n", "-f", "vintage")
        self.assertIn("restricted in vintage", out)
        code, out = check("1 Black Lotus\n59 Forest\n", "-f", "vintage")
        self.assertEqual(code, 0, out)

    def test_unknown_card(self):
        code, out = check("4 Lightnig Bolt\n56 Mountain\n", "-f", "modern")
        self.assertIn("Card not found on Scryfall", out)
        self.assertEqual(code, 1)

    def test_dfc_front_face_name(self):
        code, out = check("4 Kumano Faces Kakkazan\n56 Mountain\n", "-f", "modern")
        self.assertEqual(code, 0, out)

    def test_color_identity(self):
        deck = "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Lightning Bolt\n1 Sol Ring\n97 Forest\n"
        code, out = check(deck, "-f", "commander")
        self.assertIn("Lightning Bolt (R) is outside commander color identity (BGUW)", out)
        self.assertNotIn("Sol Ring (", out)
        self.assertEqual(code, 1)

    def test_duel_uses_its_own_banlist(self):
        deck = "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n98 Forest\n"
        self.assertEqual(check(deck, "-f", "commander")[0], 0)
        code, out = check(deck, "-f", "duel")
        self.assertIn("Sol Ring is BANNED in duel", out)

    def test_not_a_commander_warning(self):
        deck = "Commander\n1 Llanowar Elves\nDeck\n99 Forest\n"
        code, out = check(deck, "-f", "commander")
        self.assertIn("doesn't look like a legal commander", out)


if __name__ == "__main__":
    unittest.main()
