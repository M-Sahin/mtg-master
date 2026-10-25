# Contributing

Thanks for helping out. This repository has two parts:

| Part | Folder | Language | Tests |
|---|---|---|---|
| The mtg-master Claude skill | `mtg-master/` | Markdown + Python (standard library only) | `python -m unittest discover -s tests` |
| Hundredfold, the web app | `web/` | Next.js / TypeScript | `cd web && npm test && npm run typecheck` |

## Run the app locally

```bash
cd web
npm install
cp .env.example .env.local   # leave ANTHROPIC_API_KEY empty for demo mode
npm run dev
```

Demo mode needs no API key: load the demo seeds and it replays one scripted build against real Scryfall data.

## Changing the skill

1. Edit the files in `mtg-master/`.
2. Run `cd web && npm run sync-skill` and commit the regenerated `web/lib/skill/content.ts`. The app builds its system prompt from that copy, and CI fails when it's out of date.
3. Add a changelog line to the main `README.md` with the new version number.

## When Wizards changes the rules

- **The Game Changers list** is read live from Scryfall, so there's nothing to update.
- **Bracket rules:** update `web/lib/shared/bracket.ts` (the limit and the wording shown to Claude and users) and `mtg-master/references/commander.md`. Link the official announcement in your pull request.
- **Ban lists** come from Scryfall's legality data.

## Ground rules

- Card facts must come from Scryfall or Wizards, not from memory. That's the skill's main rule, and it applies to the code too.
- No paywalls and no selling: card data and images fall under the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and [Scryfall's API rules](https://scryfall.com/docs/api). Keep the Fan Content notice and the artist credits.
- Be kind in issues and reviews.

## Releasing (maintainers)

Bump the version in the README changelog. Then go to **Actions → release → Run workflow** and enter the version, or push a tag (`git tag v1.0.3 && git push origin v1.0.3`). The workflow creates the GitHub Release and attaches `mtg-master.skill`.
