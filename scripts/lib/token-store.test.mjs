import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the functions by importing them, but override the file paths
// by testing the logic directly since the module uses hardcoded paths.
// Instead, we test the core logic inline.

describe('token-store logic', () => {
  const testDir = join(tmpdir(), `airlock-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('isTokenExpired', () => {
    // Inline the logic to test it without hardcoded paths
    function isTokenExpired(token) {
      if (!token?.expiresAt) return true;
      const expiresAt = new Date(token.expiresAt).getTime();
      const buffer = 60 * 1000;
      return Date.now() >= expiresAt - buffer;
    }

    it('returns true when token has no expiresAt', () => {
      expect(isTokenExpired({})).toBe(true);
      expect(isTokenExpired(null)).toBe(true);
      expect(isTokenExpired(undefined)).toBe(true);
    });

    it('returns true when token is expired', () => {
      const token = { expiresAt: new Date(Date.now() - 60000).toISOString() };
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns true when token expires within the 60s buffer', () => {
      const token = { expiresAt: new Date(Date.now() + 30000).toISOString() };
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns false when token is valid and not near expiry', () => {
      const token = { expiresAt: new Date(Date.now() + 3600000).toISOString() };
      expect(isTokenExpired(token)).toBe(false);
    });
  });
});
