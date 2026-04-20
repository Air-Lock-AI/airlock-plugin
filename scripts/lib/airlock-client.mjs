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
  #skillsToolName;

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
   * List available skills.
   *
   * `list_skills` is a namespaced tool on the customer's airlock-management
   * service (e.g. `airlock_management/list_skills`), NOT a top-level meta-tool.
   * The service slug varies per org, so we discover the full name via
   * `search_tools` and invoke it via `execute_tool`.
   */
  async listSkills() {
    const toolName = await this.#resolveSkillsToolName();
    return this.callTool('execute_tool', { tool: toolName, arguments: {} });
  }

  async #resolveSkillsToolName() {
    if (this.#skillsToolName) return this.#skillsToolName;

    const results = await this.callTool('search_tools', { query: 'list_skills' });
    const tools = Array.isArray(results) ? results : results?.tools || [];

    const match = tools
      .map((t) => (typeof t === 'string' ? t : t?.name || t?.tool || ''))
      .find((name) => name.endsWith('/list_skills'));

    if (!match) {
      throw new Error(
        "Couldn't find a `list_skills` tool via search_tools — is the airlock management service connected to this org?"
      );
    }

    this.#skillsToolName = match;
    return match;
  }

  /**
   * Fetch a single skill's content and attachment metadata via `activate_skill`.
   * Attachments come back as `{id, filename, type}` — hydrate their bodies with
   * `readSkillAttachment(id)`.
   */
  async getSkill(skillName) {
    return this.callTool('activate_skill', { name: skillName });
  }

  /**
   * Fetch the body of a single skill attachment by ID.
   */
  async readSkillAttachment(attachmentId) {
    return this.callTool('read_skill_attachment', { attachment_id: attachmentId });
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
   *
   * No MCP meta-tool exposes approval status today — Airlock's confirmed surface
   * is `activate_skill`, `read_skill_attachment`, `list_services`, `search_tools`,
   * `describe_tools`, `execute_tool`. Until a real REST/meta-tool is wired up,
   * we return `{state: 'pending'}` so callers (stop-hook, approval poller)
   * degrade gracefully: requests stay in the pending file, pollers hit their
   * own timeout, nothing crashes.
   */
  async getApprovalStatus(requestId) {
    return { state: 'pending', requestId };
  }

  /**
   * Get the org's policy rules (for local caching in PreToolUse).
   *
   * No MCP meta-tool exposes policies today (`list_services` returns services,
   * not policy rules). Returning `null` lets `refreshPolicyCache` write an
   * empty snapshot and `matchPolicy` correctly produce no hints.
   */
  async getPolicies() {
    return null;
  }
}
