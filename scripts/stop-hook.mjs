#!/usr/bin/env node

/**
 * Stop hook — runs at the end of a Claude Code turn.
 *
 * Responsibilities:
 * 1. POST session context to Airlock for server-side processing.
 * 2. Check ~/.airlock/pending.json for any approvals that resolved since last check.
 * 3. Surface resolved approvals so the next turn can act on them.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readToken } from './lib/token-store.mjs';
import { AirlockClient } from './lib/airlock-client.mjs';

const PENDING_FILE = join(homedir(), '.airlock', 'pending.json');

async function main() {
  const token = readToken();
  if (!token) {
    process.exit(0);
  }

  const client = new AirlockClient(token);

  // POST stop event to Airlock
  try {
    await client.postHookEvent('Stop', {});
  } catch (err) {
    console.error(`[airlock] Stop hook POST failed: ${err.message}`);
  }

  // Check for resolved pending approvals
  if (!existsSync(PENDING_FILE)) {
    return;
  }

  try {
    const pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8'));
    if (!Array.isArray(pending) || pending.length === 0) {
      return;
    }

    const resolved = [];
    const stillPending = [];

    for (const request of pending) {
      try {
        const status = await client.getApprovalStatus(request.requestId);
        if (status.state === 'approved' || status.state === 'denied') {
          resolved.push({ ...request, ...status });
        } else {
          stillPending.push(request);
        }
      } catch {
        stillPending.push(request); // Keep it if we can't check
      }
    }

    // Update pending file
    writeFileSync(PENDING_FILE, JSON.stringify(stillPending, null, 2));

    // Surface resolved approvals
    for (const r of resolved) {
      const icon = r.state === 'approved' ? 'approved' : 'denied';
      console.log(`[airlock] Request ${r.requestId} (${r.toolName}) was ${icon}.`);
    }
  } catch (err) {
    console.error(`[airlock] Error checking pending approvals: ${err.message}`);
  }
}

main();
