# Security

## Reporting a problem

Please report security issues privately through [GitHub's security advisories](https://github.com/M-Sahin/mtg-master/security/advisories/new), not in a public issue. You can expect a first reply within a week.

## Keeping your own deployment safe

- Your `ANTHROPIC_API_KEY` belongs in your hosting provider's secret settings (in Vercel, a **Secret** environment variable). Never commit it, and never paste it into an issue, screenshot or log.
- On a public URL, either set `ACCESS_CODE`, or offer a limited number of free builds with `FREE_BUILDS` (with `FREE_BUILDS_PER_DAY` as a daily cap on what they can cost). Without either, the app refuses to run builds on your key unless you explicitly set `PUBLIC_ACCESS=1`.
- If logged-in visitors may save their own key to their account, keep `KEY_ENCRYPTION_SECRET` as a Secret too. It's what keeps those saved keys sealed; anyone with it and a copy of the database could open them.
- Set a monthly spend limit in the Claude Console (Billing → Spend limits) as a safety net.
- If a key leaks, revoke it in the Claude Console right away and create a new one.

## Using your own API key on a Hundredfoldz site

- Use a key from a Claude Console workspace made for this, with a monthly spend limit. A leaked key from that workspace can't cost more than the limit.
- By default the key is kept in your browser (or only in the tab, if you untick "Remember"). It's sent over HTTPS with each build, used for that build, and not stored or logged by the server. "Forget key" removes it from the browser.
- Logged in, you can choose to save the key to your account instead. The server checks it with Anthropic, seals it with AES-256-GCM under a secret only the server has (bound to your account, so a copied row doesn't open), and stores it with its last four characters. It's never sent back to the browser. "Remove it from my account" deletes it, and so does deleting your account.
- A Content Security Policy with a per-request nonce stops scripts that aren't part of the app from running on the page.
- Only paste your key into a Hundredfoldz site you trust: whoever runs a copy controls its server code. Self-hosting your own copy removes that question.
- If you think a key leaked, revoke it in the Claude Console and create a new one.
