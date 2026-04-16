/**
 * Policy cache — local snapshot of org policy rules for PreToolUse hints.
 *
 * Refreshed at SessionStart, read by PreToolUse hook.
 * Stored at ~/.airlock/policy-cache.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AIRLOCK_DIR = join(homedir(), '.airlock');
const CACHE_FILE = join(AIRLOCK_DIR, 'policy-cache.json');

/**
 * Refresh the policy cache from the Airlock MCP endpoint.
 * @param {import('./airlock-client.mjs').AirlockClient} client
 */
export async function refreshPolicyCache(client) {
  try {
    const policies = await client.getPolicies();
    mkdirSync(AIRLOCK_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(policies, null, 2));
  } catch (err) {
    console.error(`[airlock] Failed to refresh policy cache: ${err.message}`);
  }
}

/**
 * Read the cached policy snapshot. Returns null if no cache exists.
 */
export function readPolicyCache() {
  try {
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
