import json
import unittest

from helpers import CARDS, blocked_request, run_main
import scryfall


def by_name(name):
    return next(c for c in CARDS if c["name"] == name)


class Formatting(unittest.TestCase):
    def test_single_faced_card(self):
        out = scryfall.fmt_card(by_name("Lightning Bolt"))
        self.assertIn("Lightning Bolt  {R}  (MV 1)", out)
        self.assertIn("deals 3 damage to any target", out)
        self.assertIn("modern=legal", out)
        self.assertNotIn("?utm_source", out)

    def test_double_faced_card_shows_both_faces(self):
        out = scryfall.fmt_card(by_name("Kumano Faces Kakkazan // Etching of Kumano"))
        self.assertIn("[Kumano Faces Kakkazan] {R}", out)
        self.assertIn("[Etching of Kumano]", out)
        self.assertIn("2/2", out)

    def test_game_changer_and_loyalty(self):
        self.assertIn("Game Changer: yes", scryfall.fmt_card(by_name("Sol Ring")))
        self.assertIn("Loyalty: 4", scryfall.fmt_card(by_name("Oko, Thief of Crowns")))

    def test_error_object(self):
        self.assertTrue(scryfall.fmt_card({"object": "error", "details": "nope"}).startswith("ERROR"))


class Cli(unittest.TestCase):
    def test_card(self):
        code, out = run_main(scryfall, ["card", "Lightning Bolt"])
        self.assertEqual(code, 0)
        self.assertIn("Instant", out)

    def test_card_not_found_exits_nonzero(self):
        code, out = run_main(scryfall, ["card", "Definitely Not A Card"])
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)

    def test_json_flag_before_or_after_subcommand(self):
        for argv in (["--json", "card", "Sol Ring"], ["card", "Sol Ring", "--json"]):
            code, out = run_main(scryfall, argv)
            self.assertEqual(code, 0, out)
            self.assertEqual(json.loads(out)["name"], "Sol Ring")

    def test_batch_lookup_with_face_name_and_missing(self):
        code, out = run_main(scryfall, ["cards", "Lightning Bolt", "Etching of Kumano", "Nope Card"])
        self.assertEqual(code, 0)
        self.assertIn("Lightning Bolt", out)
        self.assertIn("Kumano Faces Kakkazan // Etching of Kumano", out)
        self.assertIn("NOT FOUND", out)
        self.assertIn("Nope Card", out)

    def test_batch_is_chunked_by_75(self):
        calls = []

        def counting(path, data=None):
            calls.append(len(data["identifiers"]))
            return {"object": "list", "data": [], "not_found": data["identifiers"]}

        scryfall._request, old = counting, scryfall._request
        try:
            scryfall.get_cards([f"Card {i}" for i in range(160)])
        finally:
            scryfall._request = old
        self.assertEqual(calls, [75, 75, 10])

    def test_rulings(self):
        code, out = run_main(scryfall, ["rulings", "Lightning Bolt"])
        self.assertEqual(code, 0)
        self.assertIn("Fixture ruling.", out)

    def test_network_blocked_exit_code_2(self):
        code, out = run_main(scryfall, ["card", "Lightning Bolt"], request=blocked_request)
        self.assertEqual(code, 2)
        self.assertIn("NETWORK BLOCKED", out)


if __name__ == "__main__":
    unittest.main()
