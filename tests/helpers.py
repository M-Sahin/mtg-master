"""Shared test helpers: load the skill's scripts and fake the Scryfall API with fixtures.

The fixture cards in fixtures/cards.json are shaped like real Scryfall card objects, but
their legalities are simplified for testing and are NOT a source of truth.
"""
import contextlib
import io
import json
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the skill folder

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), "mtg-master", "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import scryfall  # noqa: E402

with open(os.path.join(HERE, "fixtures", "cards.json"), encoding="utf-8") as f:
    CARDS = json.load(f)


def _index():
    idx = {}
    for c in CARDS:
        idx[c["name"].lower()] = c
        for face in c.get("card_faces", []) or []:
            idx.setdefault(face["name"].lower(), c)
    return idx


INDEX = _index()


def fake_request(path, data=None):
    """Stand-in for scryfall._request that answers from the fixtures."""
    if path.startswith("/cards/collection"):
        found, missing = [], []
        for ident in data["identifiers"]:
            c = INDEX.get(ident["name"].lower())
            (found.append(c) if c else missing.append(ident))
        return {"object": "list", "data": found, "not_found": missing}
    if path.startswith("/cards/named?"):
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(path).query)
        name = (q.get("exact") or q.get("fuzzy"))[0].lower()
        c = INDEX.get(name)
        if c is None and "fuzzy" in q:
            c = next((v for k, v in INDEX.items() if k.startswith(name)), None)
        return c or {"object": "error", "code": "not_found", "details": f"No card found named '{name}'"}
    if path.endswith("/rulings"):
        return {"object": "list", "data": [{"published_at": "2020-01-01", "source": "wotc", "comment": "Fixture ruling."}]}
    raise scryfall.NetworkBlocked(f"fixture has no route for {path}")


def blocked_request(path, data=None):
    raise scryfall.NetworkBlocked("Tunnel connection failed: 403 Forbidden")


def run_main(module, argv, request=fake_request, stdin=None):
    """Run module.main() with argv; return (exit_code, stdout+stderr)."""
    out = io.StringIO()
    old = sys.argv, scryfall._request, sys.stdin
    sys.argv = [module.__name__ + ".py"] + list(argv)
    scryfall._request = request
    if stdin is not None:
        sys.stdin = io.StringIO(stdin)
    code = 0
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            module.main()
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        sys.argv, scryfall._request, sys.stdin = old
    return code, out.getvalue()
