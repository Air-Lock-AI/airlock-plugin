#!/usr/bin/env node

/**
 * Airlock companion — main runtime bridge for the Airlock Claude Code plugin.
 *
 * Subcommands:
 *   login              — OAuth PKCE flow + initial skill sync
 *   sync               — re-sync skills from Airlock MCP
 *   status             — show connection state, skills, pending approvals
 *   execute <tool> <args> — execute an Airlock MCP tool with approval polling
 */

import { readToken, writeToken, isTokenExpired, getTokenPath } from './lib/token-store.mjs';
import { AirlockClient } from './lib/airlock-client.mjs';
import { syncSkills } from './lib/skill-sync.mjs';
import { refreshPolicyCache } from './lib/policy-cache.mjs';
import { runOAuthPkceFlow, refreshAccessToken } from './lib/oauth-pkce.mjs';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PENDING_FILE = join(homedir(), '.airlock', 'pending.json');

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'login':
      await handleLogin();
      break;
    case 'sync':
      await handleSync();
      break;
    case 'status':
      await handleStatus();
      break;
    case 'execute':
      await handleExecute(args[0], args[1]);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: airlock-companion.mjs <login|sync|status|execute>');
      process.exit(1);
  }
}

async function handleLogin() {
  console.log('Starting Airlock login...');

  const token = await runOAuthPkceFlow();
  writeToken(token);
  console.log(`Authenticated. Token expires at ${token.expiresAt}.`);

  // Run initial skill sync
  const client = new AirlockClient(token);
  try {
    const skillCount = await syncSkills(client);
    console.log(`Synced ${skillCount} skill(s) from Airlock.`);
    await refreshPolicyCache(client);
  } catch (err) {
    console.error(`Skill sync failed (non-fatal): ${err.message}`);
  }

  console.log('Login complete. Run /reload-plugins to activate synced skills.');
}

async function handleSync() {
  const token = await requireToken();
  const client = new AirlockClient(token);

  const skillCount = await syncSkills(client);
  console.log(`Synced ${skillCount} skill(s) from Airlock.`);

  await refreshPolicyCache(client);
  console.log('Policy cache refreshed.');
}

async function handleStatus() {
  const token = readToken();

  if (!token) {
    console.log('Status: Not authenticated');
    console.log(`Token file: ${getTokenPath()} (not found)`);
    console.log('Run /airlock-login to connect.');
    return;
  }

  const expired = isTokenExpired(token);
  console.log(`Organization: ${token.orgName || token.orgSlug || 'unknown'}`);
  console.log(`Token: ${expired ? 'EXPIRED' : 'valid'}`);
  console.log(`Expires: ${token.expiresAt || 'unknown'}`);

  // Count synced skills
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(new URL(import.meta.url).pathname, '..', '..');
  const manifestPath = join(pluginRoot, 'skills', '.manifest.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    console.log(`Synced skills: ${Object.keys(manifest).length}`);
  } catch {
    console.log('Synced skills: 0');
  }

  // Pending approvals
  if (existsSync(PENDING_FILE)) {
    try {
      const pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8'));
      if (pending.length > 0) {
        console.log(`Pending approvals: ${pending.length}`);
        for (const p of pending) {
          console.log(`  - ${p.requestId} (${p.toolName})`);
        }
      }
    } catch {
      // ignore
    }
  }
}

async function handleExecute(toolName, argsJson) {
  if (!toolName) {
    console.error('Usage: airlock-companion.mjs execute <tool-name> <args-json>');
    process.exit(1);
  }

  const token = await requireToken();
  const client = new AirlockClient(token);
  const toolArgs = argsJson ? JSON.parse(argsJson) : {};

  console.log(`Executing: ${toolName}`);
  const result = await client.callTool(toolName, toolArgs);

  // Check if approval is required
  if (result?.status === 'pending_approval' && result?.requestId) {
    console.log(`Approval required. Request ID: ${result.requestId}`);
    console.log('Waiting for approval...');

    // Track in pending file
    addPending(result.requestId, toolName);

    // Poll for approval
    const finalResult = await pollApproval(client, result.requestId, toolName);

    // Remove from pending
    removePending(result.requestId);

    console.log(JSON.stringify(finalResult, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

/**
 * Poll for approval status with exponential backoff.
 */
async function pollApproval(client, requestId, toolName, maxWaitMs = 300_000) {
  let interval = 5_000; // Start at 5s
  const maxInterval = 30_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(interval);

    try {
      const status = await client.getApprovalStatus(requestId);

      if (status.state === 'approved') {
        console.log('Approved!');
        return status.result || status;
      }

      if (status.state === 'denied') {
        console.log(`Denied: ${status.reason || 'No reason provided'}`);
        return status;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`Still waiting... (${elapsed}s elapsed)`);
    } catch (err) {
      console.error(`Poll error: ${err.message}`);
    }

    // Exponential backoff, capped
    interval = Math.min(interval * 1.5, maxInterval);
  }

  console.error(`Timed out waiting for approval after ${maxWaitMs / 1000}s`);
  return { state: 'timeout', requestId, toolName };
}

function addPending(requestId, toolName) {
  const dir = join(homedir(), '.airlock');
  mkdirSync(dir, { recursive: true });

  let pending = [];
  try {
    pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8'));
  } catch {
    // Start fresh
  }

  pending.push({ requestId, toolName, createdAt: new Date().toISOString() });
  writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

function removePending(requestId) {
  try {
    let pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8'));
    pending = pending.filter((p) => p.requestId !== requestId);
    writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
  } catch {
    // ignore
  }
}

async function requireToken() {
  const token = readToken();
  if (!token) {
    console.error('Not authenticated. Run /airlock-login first.');
    process.exit(1);
  }

  if (isTokenExpired(token)) {
    // Try refresh if we have a refresh token
    if (token.refreshToken && token.tokenEndpoint && token.clientId) {
      try {
        console.log('Token expired, refreshing...');
        const refreshed = await refreshAccessToken(token.tokenEndpoint, token.clientId, token.refreshToken);
        const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
        const updated = {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token || token.refreshToken,
          idToken: refreshed.id_token || token.idToken,
          expiresAt,
        };
        writeToken(updated);
        console.log('Token refreshed.');
        return updated;
      } catch (err) {
        console.error(`Token refresh failed: ${err.message}`);
        console.error('Run /airlock-login to re-authenticate.');
        process.exit(1);
      }
    }

    console.error('Token expired. Run /airlock-login to re-authenticate.');
    process.exit(1);
  }

  return token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
