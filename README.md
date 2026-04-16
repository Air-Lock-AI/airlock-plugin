# Airlock Plugin for Claude Code

Connect Claude Code to your APIs through [Airlock](https://air-lock.ai) — dynamic skills, approval workflows, and policy-aware tool execution.

## What it does

- **MCP server**: auto-configures the Airlock MCP endpoint so your org's API tools are available immediately.
- **Skill sync**: pulls your org's skills from Airlock at session start and surfaces them as native Claude Code skills.
- **Approval workflow**: a dedicated subagent handles tools that require human approval, polling until approved or denied.
- **Policy hints**: PreToolUse hook checks cached policy rules and warns before a call that will be denied or require approval.

## Installation

From the official marketplace:

```
/plugin install airlock@claude-plugins-official
```

## Setup

After installation, authenticate with your Airlock organization:

```
/airlock-login
```

This runs an OAuth flow, stores your token, and syncs your org's skills.

## Commands

| Command | Description |
|---------|-------------|
| `/airlock-login` | Authenticate with Airlock and sync skills |
| `/airlock-sync` | Manually re-sync skills mid-session |
| `/airlock-status` | Show connection status, synced skills, pending approvals |

## How it works

### Skills

At session start, the plugin pulls your org's skills from the Airlock MCP endpoint and writes them as local `SKILL.md` files. They appear natively in Claude Code's skill list — no `activate_skill` indirection. A manifest tracks content hashes for idempotent re-syncs.

### Hooks

- **SessionStart**: syncs skills and refreshes the policy cache.
- **PreToolUse**: for Airlock MCP tool calls, checks cached policy and posts the event to Airlock for server-side evaluation.
- **Stop**: checks for resolved approval requests and surfaces them.

### Approval subagent

When a tool call requires approval, the `airlock-executor` subagent handles the round-trip: it calls the tool, detects the `pending_approval` response, polls for resolution, and returns the final result. The main agent delegates once and gets back a finished result.

Normal Airlock MCP tool calls go direct — the subagent is only used for approval-required calls.

## Development

```bash
# Symlink for local testing
ln -s $(pwd) ~/.claude/plugins/airlock

# Validate the plugin
claude plugin validate .
```

## Configuration

| Environment variable | Description |
|---------------------|-------------|
| `AIRLOCK_BASE_URL` | Override the MCP endpoint (default: `https://mcp.air-lock.ai`) |

Token is stored at `~/.airlock/token.json`.

## License

MIT
