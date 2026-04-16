/**
 * Token store — reads and writes the Airlock OAuth token from ~/.airlock/token.json.
 *
 * Token shape:
 * {
 *   accessToken: string,
 *   refreshToken?: string,
 *   expiresAt: string (ISO 8601),
 *   orgSlug: string,
 *   orgName?: string
 * }
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AIRLOCK_DIR = join(homedir(), '.airlock');
const TOKEN_FILE = join(AIRLOCK_DIR, 'token.json');

/**
 * Read the stored token. Returns null if no token file exists.
 */
export function readToken() {
  try {
    const raw = readFileSync(TOKEN_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write a token to disk.
 */
export function writeToken(token) {
  mkdirSync(AIRLOCK_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
}

/**
 * Check if a token is expired (with a 60-second buffer).
 */
export function isTokenExpired(token) {
  if (!token?.expiresAt) return true;
  const expiresAt = new Date(token.expiresAt).getTime();
  const buffer = 60 * 1000; // 1 minute buffer
  return Date.now() >= expiresAt - buffer;
}

/**
 * Get the token file path (for display in status commands).
 */
export function getTokenPath() {
  return TOKEN_FILE;
}
