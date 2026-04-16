#!/usr/bin/env node

/**
 * SessionStart hook — runs when a Claude Code session begins.
 *
 * Responsibilities:
 * 1. Verify the Airlock token is present and not expired; refresh if needed.
 * 2. Sync the org's user skills from Airlock MCP to local SKILL.md files.
 * 3. Cache the org's policy snapshot for PreToolUse hints.
 */

import { readToken, writeToken, isTokenExpired } from './lib/token-store.mjs';
import { AirlockClient } from './lib/airlock-client.mjs';
import { syncSkills } from './lib/skill-sync.mjs';
import { refreshPolicyCache } from './lib/policy-cache.mjs';
import { refreshAccessToken } from './lib/oauth-pkce.mjs';

async function main() {
  let token = readToken();

  if (!token) {
    console.error('[airlock] No token found. Run /airlock-login to authenticate.');
    process.exit(0); // non-fatal — plugin still loads, just no skills
  }

  if (isTokenExpired(token)) {
    // Try automatic refresh
    if (token.refreshToken && token.tokenEndpoint && token.clientId) {
      try {
        const refreshed = await refreshAccessToken(token.tokenEndpoint, token.clientId, token.refreshToken);
        const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
        token = {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token || token.refreshToken,
          idToken: refreshed.id_token || token.idToken,
          expiresAt,
        };
        writeToken(token);
        console.log('[airlock] Token refreshed.');
      } catch {
        console.error('[airlock] Token expired and refresh failed. Run /airlock-login to re-authenticate.');
        process.exit(0);
      }
    } else {
      console.error('[airlock] Token expired. Run /airlock-login to re-authenticate.');
      process.exit(0);
    }
  }

  const client = new AirlockClient(token);

  try {
    // Sync skills from Airlock MCP → local SKILL.md files
    const skillCount = await syncSkills(client);
    if (skillCount > 0) {
      console.log(`[airlock] Synced ${skillCount} skill(s).`);
    }

    // Cache policy rules for PreToolUse hints
    await refreshPolicyCache(client);
  } catch (err) {
    console.error(`[airlock] Session start error: ${err.message}`);
    // Non-fatal — session continues without synced skills
  }
}

main();
