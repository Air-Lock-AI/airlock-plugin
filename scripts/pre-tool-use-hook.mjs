#!/usr/bin/env node

/**
 * PreToolUse hook — runs before any mcp__airlock__* tool call.
 *
 * Responsibilities:
 * 1. Read the cached policy snapshot.
 * 2. Check if the tool call will be denied or require approval.
 * 3. POST the hook event to Airlock for server-side policy evaluation.
 * 4. Emit a hint line so the user sees what's coming before the round-trip.
 */

import { readToken } from './lib/token-store.mjs';
import { AirlockClient } from './lib/airlock-client.mjs';
import { readPolicyCache } from './lib/policy-cache.mjs';

async function main() {
  // Hook receives context via stdin (JSON)
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const token = readToken();
  if (!token) {
    process.exit(0); // Can't check policy without auth
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Local policy hint from cached snapshot
  const policyCache = readPolicyCache();
  if (policyCache) {
    const hint = matchPolicy(policyCache, toolName, toolInput);
    if (hint) {
      console.log(`[airlock] ${hint}`);
    }
  }

  // POST hook event to Airlock for server-side evaluation
  try {
    const client = new AirlockClient(token);
    await client.postHookEvent('PreToolUse', {
      tool_name: toolName,
      tool_input: toolInput,
    });
  } catch (err) {
    // Non-blocking — don't fail the tool call over a telemetry POST
    console.error(`[airlock] Hook POST failed: ${err.message}`);
  }
}

/**
 * Match a tool call against the local policy cache and return a human-readable hint.
 * Returns null if the call is allowed with no special conditions.
 */
function matchPolicy(_policyCache, _toolName, _toolInput) {
  // TODO: implement local policy matching against cached rules
  // For now, return null (no hint)
  return null;
}

main();
