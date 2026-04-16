---
description: Manually re-sync skills from your Airlock organization
allowed-tools: Bash(node:*)
---

Trigger a manual skill sync from Airlock:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock-companion.mjs" sync
```

This pulls the latest skills from the org's Airlock MCP endpoint and writes them as local SKILL.md files. Useful when an admin just added or updated a skill mid-session.

After the sync, tell the user how many skills were synced and remind them to run `/reload-plugins` to pick up any new skills.
