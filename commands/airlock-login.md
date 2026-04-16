---
description: Authenticate with Airlock and sync your org's skills
allowed-tools: Bash(node:*)
---

Run the Airlock login flow to authenticate and set up the plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock-companion.mjs" login
```

This will:
1. Start an OAuth PKCE flow against Airlock's auth server.
2. Open a browser for the user to sign in and select their organization.
3. Store the token in `~/.airlock/token.json`.
4. Run an initial skill sync to pull the org's skills.

After login completes, tell the user their org name and how many skills were synced. If the login fails, show the error and suggest they try again.
