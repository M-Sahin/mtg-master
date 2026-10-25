# Security

## Reporting a problem

Please report security issues privately through [GitHub's security advisories](https://github.com/M-Sahin/mtg-master/security/advisories/new), not in a public issue. You can expect a first reply within a week.

## Keeping your own deployment safe

- Your `ANTHROPIC_API_KEY` belongs in your hosting provider's secret settings (in Vercel, a **Secret** environment variable). Never commit it, and never paste it into an issue, screenshot or log.
- On a public URL, set `ACCESS_CODE`. Without it, anyone who finds the URL can build decks on your API credits. The app refuses to run live builds without an access code unless you explicitly set `PUBLIC_ACCESS=1`.
- Set a monthly spend limit in the Claude Console (Billing → Spend limits) as a safety net.
- If a key leaks, revoke it in the Claude Console right away and create a new one.
