# Security

## Reporting a problem

Please report security issues in the skill privately through [GitHub's security advisories](https://github.com/M-Sahin/mtg-master/security/advisories/new), not in a public issue. You can expect a first reply within a week.

For the Hundredfoldz web app (the site, accounts, API keys), report it in [its own repository](https://github.com/M-Sahin/hundredfoldz/security/advisories/new).

## What the skill does on your machine

- The scripts in `mtg-master/scripts/` use only Python's standard library. They read the decklists you give them and talk only to `api.scryfall.com`, over HTTPS.
- They need no API key, account or password, and store nothing.
- Install skills only from sources you trust: a skill's instructions and scripts run with the access you give Claude. The `mtg-master.skill` file attached to each [release](https://github.com/M-Sahin/mtg-master/releases) is built by this repository's release workflow from the tagged code.
