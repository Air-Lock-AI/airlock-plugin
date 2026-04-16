/**
 * Airlock HTTP client — thin wrapper over the Airlock MCP endpoint.
 *
 * All requests use the same OAuth token for authentication.
 * Speaks MCP JSON-RPC for tool calls and skill enumeration,
 * and plain REST for hook event posting and approval status.
 */

const DEFAULT_BASE_URL = 'https://mcp.air-lock.ai';

export class AirlockClient {
  #token;
  #baseUrl;

  /**
   * @param {object} token - Token object from token-store (must have .accessToken)
   * @param {string} [baseUrl] - Override the Airlock endpoint (for dev/staging)
   */
  constructor(token, baseUrl) {
    this.#token = token;
    this.#baseUrl = baseUrl || process.env.AIRLOCK_BASE_URL || DEFAULT_BASE_URL;
  }

  /**
   * Make an MCP JSON-RPC call to the Airlock endpoint.
   */
  async mcpCall(method, params = {}) {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    const res = await fetch(this.#baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#token.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`MCP call failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(`MCP error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    return json.result;
  }

  /**
   * Call an MCP tool by name with the given arguments.
   */
  async callTool(toolName, args = {}) {
    return this.mcpCall('tools/call', { name: toolName, arguments: args });
  }

  /**
   * List available skills via the MCP meta-tools.
   */
  async listSkills() {
    // TODO: confirm the exact meta-tool name from skill-tools.ts
    // This might be 'activate_skill' with a list action, or a separate tool
    return this.callTool('activate_skill', { action: 'list' });
  }

  /**
   * Fetch a single skill's full content and attachments.
   */
  async getSkill(skillName) {
    // TODO: confirm the exact meta-tool name and params
    return this.callTool('activate_skill', { name: skillName });
  }

  /**
   * POST a hook event to Airlock for server-side processing.
   * Uses the same OAuth token as MCP calls.
   */
  async postHookEvent(eventType, payload) {
    const res = await fetch(`${this.#baseUrl}/hooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#token.accessToken}`,
      },
      body: JSON.stringify({
        eventType,
        payload,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      throw new Error(`Hook POST failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Check the status of a pending approval request.
   */
  async getApprovalStatus(requestId) {
    // TODO: confirm the exact endpoint / meta-tool for approval status
    return this.callTool('execute_tool', {
      tool: '_airlock/approval_status',
      arguments: { requestId },
    });
  }

  /**
   * Get the org's policy rules (for local caching in PreToolUse).
   */
  async getPolicies() {
    // TODO: confirm the exact meta-tool for policy listing
    return this.callTool('list_services', {});
  }
}
