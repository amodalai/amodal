/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
  type ToolInvocation,
} from '@google/gemini-cli-core';
import { ToolErrorType } from '@google/gemini-cli-core';
import type { HttpToolConfig } from './http-tool-types.js';
import {
  resolveTemplate,
  resolveTemplateObject,
  type TemplateContext,
  type TemplateError,
} from '../templates/template-resolver.js';
import type { ConnectionsMap } from '../templates/connections.js';
import { isPrivateIp } from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core';
import { httpFetch, shapeResponse, formatTemplateErrors } from './tool-utils.js';

type HttpToolParams = Record<string, unknown>;

/**
 * Invocation for an HTTP tool call.
 */
export class HttpToolInvocation extends BaseToolInvocation<
  HttpToolParams,
  ToolResult
> {
  constructor(
    params: HttpToolParams,
    messageBus: MessageBus,
    toolName: string,
    toolDisplayName: string,
    private readonly config: HttpToolConfig,
    private readonly connections: ConnectionsMap,
  ) {
    super(params, messageBus, toolName, toolDisplayName);
  }

  getDescription(): string {
    return `${this.config.method} ${this.config.urlTemplate}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const context: TemplateContext = {
      connections: this.connections,
      params: this.params,
    };

    // 1. Resolve URL template
    const urlResult = resolveTemplate(this.config.urlTemplate, context);
    if (urlResult.errors.length > 0) {
      return this.templateError('URL', urlResult.errors);
    }

    // 2. Resolve query params and append to URL
    let fullUrl = urlResult.value;
    if (this.config.queryParams) {
      const qpResult = resolveTemplateObject(this.config.queryParams, context);
      if (qpResult.errors.length > 0) {
        return this.templateError('query params', qpResult.errors);
      }
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(qpResult.value)) {
        searchParams.append(key, String(val));
      }
      const sep = fullUrl.includes('?') ? '&' : '?';
      fullUrl = `${fullUrl}${sep}${searchParams.toString()}`;
    }

    // 3. Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Invalid URL: ${fullUrl}`,
      );
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Unsupported protocol: ${parsedUrl.protocol}. Only http and https are allowed.`,
      );
    }

    // 4. Private IP check
    if (isPrivateIp(fullUrl)) {
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Request to private IP address blocked: ${parsedUrl.hostname}`,
      );
    }

    // 5. Resolve headers
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    let resolvedHeaders = baseHeaders;
    if (this.config.headers) {
      const headersResult = resolveTemplateObject(this.config.headers, context);
      if (headersResult.errors.length > 0) {
        return this.templateError('headers', headersResult.errors);
      }
      resolvedHeaders = { ...baseHeaders, ...headersResult.value };
    }

    // 6. Resolve body for POST/PUT/PATCH
    let body: string | undefined;
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    if (methodsWithBody.includes(this.config.method) && this.config.bodyTemplate !== undefined) {
      if (typeof this.config.bodyTemplate === 'string') {
        const bodyResult = resolveTemplate(this.config.bodyTemplate, context);
        if (bodyResult.errors.length > 0) {
          return this.templateError('body', bodyResult.errors);
        }
        body = bodyResult.value;
      } else {
        const bodyResult = resolveTemplateObject(this.config.bodyTemplate, context);
        if (bodyResult.errors.length > 0) {
          return this.templateError('body', bodyResult.errors);
        }
        body = JSON.stringify(bodyResult.value);
      }
    }

    // 7. Make the HTTP request
    let response: Response;
    try {
      response = await httpFetch(fullUrl, {
        method: this.config.method,
        headers: resolvedHeaders,
        body,
        timeout: this.config.timeout,
        signal,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort')) {
        return this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Request timed out after ${this.config.timeout}ms`,
        );
      }
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `HTTP request failed: ${message}`,
      );
    }

    // 8. Handle HTTP errors
    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '';
      }
      const truncatedBody = errorBody.length > 500 ? errorBody.slice(0, 500) + '...' : errorBody;
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `HTTP ${response.status} ${response.statusText}: ${truncatedBody}`,
      );
    }

    // 9. Parse response
    let responseData: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }
    } else {
      responseData = await response.text();
    }

    // 10. Shape response
    const shaped = shapeResponse(responseData, this.config.responseShaping);

    return {
      llmContent: shaped,
      returnDisplay: shaped,
    };
  }

  private templateError(
    location: string,
    errors: TemplateError[],
  ): ToolResult {
    const msg = `Template resolution failed in ${location}:\n${formatTemplateErrors(errors)}`;
    return this.errorResult(ToolErrorType.EXECUTION_FAILED, msg);
  }

  private errorResult(type: ToolErrorType, message: string): ToolResult {
    return {
      llmContent: `Error: ${message}`,
      returnDisplay: message,
      error: { message, type },
    };
  }
}

/**
 * A declarative HTTP tool — configured via JSON, no custom code.
 */
export class HttpTool extends BaseDeclarativeTool<HttpToolParams, ToolResult> {
  constructor(
    private readonly httpConfig: HttpToolConfig,
    private readonly connections: ConnectionsMap,
    messageBus: MessageBus,
  ) {
    super(
      httpConfig.name,
      httpConfig.displayName,
      httpConfig.description,
      Kind.Fetch,
      httpConfig.parameters,
      messageBus,
      false, // isOutputMarkdown
      false, // canUpdateOutput
      undefined, // extensionName
      undefined, // extensionId
    );
  }

  protected createInvocation(
    params: HttpToolParams,
    messageBus: MessageBus,
    toolName?: string,
    toolDisplayName?: string,
  ): ToolInvocation<HttpToolParams, ToolResult> {
    return new HttpToolInvocation(
      params,
      messageBus,
      toolName ?? this.name,
      toolDisplayName ?? this.displayName,
      this.httpConfig,
      this.connections,
    );
  }
}
