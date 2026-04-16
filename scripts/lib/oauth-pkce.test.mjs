import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

describe('oauth-pkce logic', () => {
  describe('PKCE code challenge generation', () => {
    function generatePkce() {
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      return { codeVerifier, codeChallenge };
    }

    it('generates a code_verifier of valid length (43-128 chars)', () => {
      const { codeVerifier } = generatePkce();
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeVerifier.length).toBeLessThanOrEqual(128);
    });

    it('generates a code_challenge that is base64url encoded', () => {
      const { codeChallenge } = generatePkce();
      // base64url: only alphanumeric, hyphen, underscore — no +, /, =
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates different values each time', () => {
      const a = generatePkce();
      const b = generatePkce();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.codeChallenge).not.toBe(b.codeChallenge);
    });

    it('code_challenge is SHA256 of code_verifier', () => {
      const { codeVerifier, codeChallenge } = generatePkce();
      const expected = createHash('sha256').update(codeVerifier).digest('base64url');
      expect(codeChallenge).toBe(expected);
    });
  });

  describe('authorize URL construction', () => {
    function buildAuthorizeUrl(authorizationEndpoint, { clientId, redirectUri, codeChallenge, state, scopes }) {
      const url = new URL(authorizationEndpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', state);
      url.searchParams.set('scope', scopes.join(' '));
      return url.toString();
    }

    it('includes all required OAuth parameters', () => {
      const url = buildAuthorizeUrl('https://auth.air-lock.ai/authorize', {
        clientId: 'test-client',
        redirectUri: 'http://localhost:8400/callback',
        codeChallenge: 'abc123',
        state: 'state456',
        scopes: ['openid', 'profile', 'email'],
      });

      expect(url).toContain('response_type=code');
      expect(url).toContain('client_id=test-client');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('code_challenge=abc123');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('state=state456');
      expect(url).toContain('scope=openid+profile+email');
    });
  });

  describe('state validation', () => {
    it('generates 32-char hex state string', () => {
      const state = randomBytes(16).toString('hex');
      expect(state).toHaveLength(32);
      expect(state).toMatch(/^[0-9a-f]+$/);
    });
  });
});
