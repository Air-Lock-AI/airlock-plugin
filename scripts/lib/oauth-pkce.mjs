/**
 * OAuth PKCE flow for Airlock CLI authentication.
 *
 * Follows the MCP OAuth spec:
 * 1. Discover endpoints via .well-known/oauth-authorization-server
 * 2. Register a dynamic client (RFC 7591)
 * 3. Generate PKCE code_verifier + code_challenge
 * 4. Open browser to authorize endpoint
 * 5. Listen on localhost for the callback
 * 6. Exchange code + code_verifier for tokens
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { URL } from 'node:url';

const DEFAULT_MCP_DOMAIN = 'https://mcp.air-lock.ai';

/**
 * Run the full OAuth PKCE login flow.
 * Opens a browser, waits for callback, returns token object.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Override MCP domain
 * @param {number} [options.port] - Localhost port for callback (default: 8400)
 * @returns {Promise<object>} Token object ready for token-store
 */
export async function runOAuthPkceFlow(options = {}) {
  const baseUrl = options.baseUrl || process.env.AIRLOCK_BASE_URL || DEFAULT_MCP_DOMAIN;
  const port = options.port || 8400;
  const redirectUri = `http://localhost:${port}/callback`;

  // 1. Discover endpoints
  console.log('Discovering Airlock OAuth endpoints...');
  const metadata = await discoverMetadata(baseUrl);

  // 2. Register dynamic client
  console.log('Registering client...');
  const clientId = await registerClient(metadata.registration_endpoint, redirectUri);

  // 3. Generate PKCE
  const { codeVerifier, codeChallenge } = generatePkce();

  // 4. Build authorize URL
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(metadata.authorization_endpoint, {
    clientId,
    redirectUri,
    codeChallenge,
    state,
    scopes: metadata.scopes_supported || ['openid', 'profile', 'email'],
  });

  // 5. Start local server and wait for callback
  const { code } = await openBrowserAndWaitForCallback(authorizeUrl, port, state);

  // 6. Exchange code for tokens
  console.log('Exchanging authorization code for tokens...');
  const tokenResponse = await exchangeCode(metadata.token_endpoint, {
    code,
    codeVerifier,
    clientId,
    redirectUri,
  });

  // Build token object for storage
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || null,
    idToken: tokenResponse.id_token || null,
    expiresAt,
    clientId,
    tokenEndpoint: metadata.token_endpoint,
  };
}

/**
 * Discover OAuth authorization server metadata.
 */
async function discoverMetadata(baseUrl) {
  const url = `${baseUrl}/.well-known/oauth-authorization-server`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to discover OAuth metadata at ${url}: ${res.status}`);
  }

  return res.json();
}

/**
 * Register a dynamic OAuth client (RFC 7591).
 */
async function registerClient(registrationEndpoint, redirectUri) {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Airlock Claude Code Plugin',
    }),
  });

  if (!res.ok) {
    throw new Error(`Dynamic client registration failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.client_id;
}

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 */
function generatePkce() {
  // code_verifier: 43-128 character random string
  const codeVerifier = randomBytes(32).toString('base64url');

  // code_challenge: BASE64URL(SHA256(code_verifier))
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  return { codeVerifier, codeChallenge };
}

/**
 * Build the authorization URL with all required parameters.
 */
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

/**
 * Open the browser and start a local HTTP server to receive the OAuth callback.
 * Returns the authorization code.
 */
function openBrowserAndWaitForCallback(authorizeUrl, port, expectedState) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 5 minutes. Please try again.'));
    }, 5 * 60 * 1000);

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        const description = url.searchParams.get('error_description') || error;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(errorPage(description));
        clearTimeout(timeout);
        server.close();
        reject(new Error(`Authorization failed: ${description}`));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(errorPage('State mismatch — possible CSRF attack. Please try again.'));
        clearTimeout(timeout);
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(errorPage('No authorization code received.'));
        clearTimeout(timeout);
        server.close();
        reject(new Error('No authorization code in callback'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(successPage());
      clearTimeout(timeout);
      server.close();
      resolve({ code });
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`\nOpen this URL in your browser to sign in:\n\n  ${authorizeUrl}\n`);

      // Try to open the browser automatically
      openBrowser(authorizeUrl).catch(() => {
        // Silent fail — the URL is already printed above
      });
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try again or use a different port.`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Exchange authorization code for tokens.
 */
async function exchangeCode(tokenEndpoint, { code, codeVerifier, clientId, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(tokenEndpoint, clientId, refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Open a URL in the default browser (best-effort, cross-platform).
 */
async function openBrowser(url) {
  const { exec } = await import('node:child_process');
  const { platform } = await import('node:os');

  const cmd =
    platform() === 'darwin'
      ? `open "${url}"`
      : platform() === 'win32'
        ? `start "${url}"`
        : `xdg-open "${url}"`;

  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

function successPage() {
  return `<!DOCTYPE html>
<html>
<head><title>Airlock — Signed In</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center; max-width: 400px;">
    <h1 style="color: #1a1a1a; font-size: 24px;">Signed in to Airlock</h1>
    <p style="color: #666;">You can close this tab and return to Claude Code.</p>
  </div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html>
<head><title>Airlock — Error</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center; max-width: 400px;">
    <h1 style="color: #dc3545; font-size: 24px;">Authentication Failed</h1>
    <p style="color: #666;">${message}</p>
    <p style="color: #999; font-size: 14px;">Close this tab and try <code>/airlock-login</code> again in Claude Code.</p>
  </div>
</body>
</html>`;
}
