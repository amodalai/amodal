/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { MessageBus } from '@google/gemini-cli-core';
import type {
  ToolResult,
  ToolInvocation,
} from '@google/gemini-cli-core';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
} from '@google/gemini-cli-core';
import { ToolErrorType } from '@google/gemini-cli-core';
import type { ConnectionsMap } from '../templates/connections.js';
import { isPrivateIp } from '@google/gemini-cli-core';
import { httpFetch, shapeResponse } from './tool-utils.js';
import { getRequestToolDefinition } from './definitions/amodal-tools.js';
import type { RequestToolParams, RequestSecurityConfig } from './request-tool-types.js';
import { REQUEST_TOOL_NAME } from './request-tool-types.js';

/**
 * Internal shape stored in ConnectionConfig under `_request_config`.
 */
interface RequestConfig {
  base_url_field: string;
  auth: Array<{ header: string; value_template: string }>;
  default_headers: Record<string, string>;
}

/**
 * Resolve a template string like `{{API_KEY}}` against a credentials map.
 */
function resolveAuthTemplate(
  template: string,
  credentials: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = credentials[key];
    return value !== undefined ? String(value) : '';
  });
}

/**
 * Expand `$VAR_NAME` references in a string from the session-scoped env map.
 * LLMs commonly write `$CUSTOMER_APP_ID` in endpoint paths; these are
 * app secrets available via the session's connection credentials.
 */
function expandEnvVars(input: string, sessionEnv: Record<string, string>): string {
  return input.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match, name: string) => {
    const value = sessionEnv[name];
    return value !== undefined ? value : _match;
  });
}

class RequestToolInvocation extends BaseToolInvocation<
  RequestToolParams,
  ToolResult
> {
  constructor(
    params: RequestToolParams,
    messageBus: MessageBus,
    private readonly connections: ConnectionsMap,
    private readonly readOnly: boolean,
    private readonly sessionEnv: Record<string, string>,
    private readonly security?: RequestSecurityConfig,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `${this.params.method} ${this.params.connection}${this.params.endpoint}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    // Task agents cannot write
    if (this.readOnly && (this.params.intent === 'write' || this.params.intent === 'confirmed_write')) {
      return this.errorResult(
        ToolErrorType.INVALID_TOOL_PARAMS,
        'Task agents can only use intent: "read". Write operations require the primary agent.',
      );
    }

    // Plan mode blocks writes
    if (
      this.security?.planModeActive?.() &&
      (this.params.intent === 'write' || this.params.intent === 'confirmed_write')
    ) {
      return this.errorResult(
        ToolErrorType.INVALID_TOOL_PARAMS,
        'Plan mode is active. Present your plan to the user for approval before executing write operations. Reads and explore are allowed freely.',
      );
    }

    // 1. Look up connection
    const connectionConfig = this.connections[this.params.connection];
    if (!connectionConfig) {
      const available = Object.keys(this.connections).join(', ') || '(none)';
      return this.errorResult(
        ToolErrorType.INVALID_TOOL_PARAMS,
        `Connection "${this.params.connection}" not found. Available connections: ${available}`,
      );
    }

    // 2. Extract request_config
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- internal convention for request config storage
    const requestConfig = connectionConfig['_request_config'] as RequestConfig | undefined;
    if (!requestConfig) {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Connection "${this.params.connection}" does not have a request_config. Cannot determine base URL or auth.`,
      );
    }

    // 3. Build full URL
    const baseUrl = connectionConfig[requestConfig.base_url_field];
    if (!baseUrl || typeof baseUrl !== 'string') {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Connection "${this.params.connection}" is missing the base URL field "${requestConfig.base_url_field}".`,
      );
    }

    // Normalize: strip trailing slash from base, ensure endpoint starts with /
    // Expand $ENV_VAR references in the endpoint (LLMs write $CUSTOMER_APP_ID etc.)
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const expandedEndpoint = expandEnvVars(this.params.endpoint, this.sessionEnv);
    const normalizedEndpoint = expandedEndpoint.startsWith('/')
      ? expandedEndpoint
      : `/${expandedEndpoint}`;
    let fullUrl = `${normalizedBase}${normalizedEndpoint}`;

    // 4. Append query params (also expand env vars in values)
    if (this.params.params && Object.keys(this.params.params).length > 0) {
      const expandedParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(this.params.params)) {
        expandedParams[k] = expandEnvVars(v, this.sessionEnv);
      }
      const searchParams = new URLSearchParams(expandedParams);
      const sep = fullUrl.includes('?') ? '&' : '?';
      fullUrl = `${fullUrl}${sep}${searchParams.toString()}`;
    }

    // 5. Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Invalid URL constructed: ${fullUrl}`,
      );
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Unsupported protocol: ${parsedUrl.protocol}. Only http and https are allowed.`,
      );
    }

    if (isPrivateIp(fullUrl)) {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        'Requests to private/internal IP addresses are not allowed.',
      );
    }

    // 6. Build headers
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...requestConfig.default_headers,
    };

    // Resolve auth headers
    for (const auth of requestConfig.auth) {
      headers[auth.header] = resolveAuthTemplate(auth.value_template, connectionConfig);
    }

    // Add extra headers from params
    if (this.params.headers) {
      Object.assign(headers, this.params.headers);
    }

    // 7. Build request body
    let body: string | undefined;
    if (this.params.data !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      body = typeof this.params.data === 'string'
        ? this.params.data
        : JSON.stringify(this.params.data);
    }

    // 7b. Action gate check for write operations
    if (
      this.security?.actionGate &&
      (this.params.intent === 'write' || this.params.intent === 'confirmed_write')
    ) {
      const gateResult = this.security.actionGate.evaluate(
        `${this.params.method} ${this.params.endpoint}`,
        this.params.connection,
        this.params.data !== undefined
          ? {data: this.params.data, ...this.params.params}
          : this.params.params,
      );

      if (gateResult.decision === 'never') {
        return this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Action blocked: ${gateResult.reason ?? 'This operation is not permitted.'}`,
        );
      }

      if (gateResult.decision === 'review') {
        return {
          llmContent: `This action requires human review before execution.\nEndpoint: ${this.params.method} ${this.params.endpoint}\nReason: ${gateResult.reason ?? 'Escalated for review'}\n\nPresent this to the user for review approval.`,
          returnDisplay: `Review required: ${this.params.method} ${this.params.connection}${this.params.endpoint}`,
        };
      }

      // 'confirm' and 'allow' proceed normally
    }

    // 7c. Write intent returns preview without executing
    if (this.params.intent === 'write') {
      const sanitizedHeaders = Object.entries(headers)
        .map(([k, v]) => {
          // Hide auth values
          const isAuth = requestConfig.auth.some((a) => a.header === k);
          return `${k}: ${isAuth ? '[set]' : v}`;
        })
        .join(', ');

      const lines = [
        'WRITE PREVIEW (not executed)',
        `${this.params.method} ${fullUrl}`,
      ];

      if (requestConfig.auth.length > 0) {
        const authSummary = requestConfig.auth
          .map((a) => `${a.header} [set]`)
          .join(', ');
        lines.push(`Auth: ${authSummary}`);
      }

      lines.push(`Headers: ${sanitizedHeaders}`);

      if (body !== undefined) {
        lines.push(`Body: ${body}`);
      }

      lines.push('');
      lines.push('To execute, present this to the user for confirmation, then call again with intent: "confirmed_write".');

      const previewText = lines.join('\n');
      return {
        llmContent: previewText,
        returnDisplay: `Preview: ${this.params.method} ${this.params.connection}${this.params.endpoint}`,
      };
    }

    // 8. Make request
    let response: Response;
    try {
      response = await httpFetch(fullUrl, {
        method: this.params.method,
        headers,
        body,
        timeout: 30000,
        signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Request failed: ${message}`,
      );
    }

    // 9. Parse and shape response
    const statusText = `HTTP ${String(response.status)}`;
    let responseData: unknown;
    const contentType = response.headers.get('content-type') ?? '';

    try {
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }
    } catch {
      responseData = `[Could not parse response body]`;
    }

    // 9b. Field scrubbing — strip restricted fields before shaping
    if (this.security?.fieldScrubber && responseData !== undefined) {
      const endpointKey = `${this.params.method} ${this.params.endpoint}`;
      const scrubResult = this.security.fieldScrubber.scrub(
        responseData,
        endpointKey,
        this.params.connection,
      );
      responseData = scrubResult.data;
    }

    const shaped = shapeResponse(responseData, undefined);
    const resultText = `${statusText}\n${shaped}`;

    if (!response.ok) {
      return {
        llmContent: resultText,
        returnDisplay: `${statusText} ${this.params.method} ${this.params.connection}${this.params.endpoint}`,
        error: {
          message: resultText,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    return {
      llmContent: resultText,
      returnDisplay: `${statusText} ${this.params.method} ${this.params.connection}${this.params.endpoint}`,
    };
  }

  private errorResult(
    type: ToolErrorType,
    message: string,
  ): ToolResult {
    return {
      llmContent: `Error: ${message}`,
      returnDisplay: `Error: ${message}`,
      error: { message, type },
    };
  }
}

/**
 * Built-in tool for making HTTP requests to connected systems.
 * Intent-based confirmation: read=free, write=confirmed.
 */
export class RequestTool extends BaseDeclarativeTool<
  RequestToolParams,
  ToolResult
> {
  static readonly Name = REQUEST_TOOL_NAME;

  constructor(
    private readonly connections: ConnectionsMap,
    messageBus: MessageBus,
    private readonly readOnly = false,
    private readonly sessionEnv: Record<string, string> = {},
    private readonly security?: RequestSecurityConfig,
  ) {
    const definition = getRequestToolDefinition();

    super(
      RequestTool.Name,
      'Request',
      definition.base.description!,
      Kind.Fetch,
      definition.base.parametersJsonSchema,
      messageBus,
      true,
      false,
      undefined,
      undefined,
    );
  }

  /**
   * Returns a new RequestTool instance with readOnly=true, sharing the same
   * connections and message bus. Used by LocalAgentExecutor to give task agents
   * a read-only version of the request tool.
   */
  asReadOnly(): RequestTool {
    if (this.readOnly) return this;
    return new RequestTool(this.connections, this.messageBus, true, this.sessionEnv, this.security);
  }

  protected createInvocation(
    params: RequestToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<RequestToolParams, ToolResult> {
    return new RequestToolInvocation(
      params,
      messageBus,
      this.connections,
      this.readOnly,
      this.sessionEnv,
      this.security,
      _toolName,
      _toolDisplayName ?? 'Request',
    );
  }
}
