---
description: Show Airlock connection status, synced skills, and pending approvals
allowed-tools: Bash(node:*)
---

Check the current Airlock plugin status:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock-companion.mjs" status
```

This shows:
- Current organization name
- Token expiry time
- Number of synced skills
- Any pending approval requests

Present the output in a clean, readable format. If the token is expired or missing, suggest running `/airlock-login`.
