# Contributing

Thanks for helping out. This repository is the mtg-master Claude skill: Markdown plus Python (standard library only). The web app built on it, Hundredfoldz, lives in [M-Sahin/hundredfoldz](https://github.com/M-Sahin/hundredfoldz).

## Run the tests

```bash
python -m unittest discover -s tests -v
```

They run offline, with Scryfall mocked. To try the skill itself, install your working copy in Claude Code (`ln -s "$PWD/mtg-master" ~/.claude/skills/mtg-master`) or zip it for the Claude apps (see the README).

## Changing the skill

1. Edit the files in `mtg-master/`.
2. Add a changelog line to `README.md` with the new version number.
3. After the release (below), Hundredfoldz picks it up when its pinned version is moved to the new tag.

## When Wizards changes the rules

- **The Game Changers list** is read live from Scryfall, so there's nothing to update.
- **Bracket rules:** update `mtg-master/references/commander.md`, and link the official announcement in your pull request. Hundredfoldz has its own copy of the rules in code (see its CONTRIBUTING.md).
- **Ban lists** come from Scryfall's legality data.

## Ground rules

- Card facts must come from Scryfall or Wizards, not from memory. That's the skill's main rule, and it applies to the code too.
- No paywalls and no selling: card data and images fall under the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and [Scryfall's API rules](https://scryfall.com/docs/api). Keep the Fan Content notice and the artist credits.
- Be kind in issues and reviews.

## Releasing (maintainers)

Bump the version in the README changelog. Then go to **Actions → release → Run workflow** and enter the version, or push a tag (`git tag v1.0.3 && git push origin v1.0.3`). The workflow creates the GitHub Release and attaches `mtg-master.skill`.
