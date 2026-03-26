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
import type { ChainToolConfig, ChainStep } from './chain-tool-types.js';
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
import {
  resolveMergeTemplate,
  resolveMergeTemplateObject,
  type MergeTemplateContext,
} from './merge-template.js';

type ChainToolParams = Record<string, unknown>;

/**
 * Invocation for a chain tool call — parallel HTTP steps merged into one result.
 */
export class ChainToolInvocation extends BaseToolInvocation<
  ChainToolParams,
  ToolResult
> {
  constructor(
    params: ChainToolParams,
    messageBus: MessageBus,
    toolName: string,
    toolDisplayName: string,
    private readonly config: ChainToolConfig,
    private readonly connections: ConnectionsMap,
  ) {
    super(params, messageBus, toolName, toolDisplayName);
  }

  getDescription(): string {
    const stepNames = this.config.steps.map((s) => s.name).join(', ');
    return `Chain: [${stepNames}]`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const controller = new AbortController();
    const aggregateTimeout = setTimeout(
      () => controller.abort(),
      this.config.timeout,
    );

    // Forward external abort
    if (signal.aborted) {
      clearTimeout(aggregateTimeout);
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        'Chain aborted before execution',
      );
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      // Execute all steps in parallel
      const stepPromises = this.config.steps.map((step) =>
        this.executeStep(step, controller.signal),
      );

      const results = await Promise.all(stepPromises);

      // Check for step failures
      for (const result of results) {
        if (result.error) {
          return result.error;
        }
      }

      // Build merge context
      const mergeContext: MergeTemplateContext = {};
      for (const result of results) {
        mergeContext[result.name] = result.data;
      }

      // Apply merge template
      return this.applyMerge(mergeContext);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort')) {
        return this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Chain timed out after ${this.config.timeout}ms`,
        );
      }
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Chain execution failed: ${message}`,
      );
    } finally {
      clearTimeout(aggregateTimeout);
    }
  }

  private async executeStep(
    step: ChainStep,
    signal: AbortSignal,
  ): Promise<{ name: string; data: unknown; error?: ToolResult }> {
    const context: TemplateContext = {
      connections: this.connections,
      params: this.params,
    };

    // 1. Resolve URL template
    const urlResult = resolveTemplate(step.urlTemplate, context);
    if (urlResult.errors.length > 0) {
      return {
        name: step.name,
        data: null,
        error: this.stepTemplateError(step.name, 'URL', urlResult.errors),
      };
    }

    // 2. Resolve query params
    let fullUrl = urlResult.value;
    if (step.queryParams) {
      const qpResult = resolveTemplateObject(step.queryParams, context);
      if (qpResult.errors.length > 0) {
        return {
          name: step.name,
          data: null,
          error: this.stepTemplateError(step.name, 'query params', qpResult.errors),
        };
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
      return {
        name: step.name,
        data: null,
        error: this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Step "${step.name}": Invalid URL: ${fullUrl}`,
        ),
      };
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        name: step.name,
        data: null,
        error: this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Step "${step.name}": Unsupported protocol: ${parsedUrl.protocol}`,
        ),
      };
    }

    // 4. Private IP check
    if (isPrivateIp(fullUrl)) {
      return {
        name: step.name,
        data: null,
        error: this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Step "${step.name}": Request to private IP blocked: ${parsedUrl.hostname}`,
        ),
      };
    }

    // 5. Resolve headers
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    let resolvedHeaders = baseHeaders;
    if (step.headers) {
      const headersResult = resolveTemplateObject(step.headers, context);
      if (headersResult.errors.length > 0) {
        return {
          name: step.name,
          data: null,
          error: this.stepTemplateError(step.name, 'headers', headersResult.errors),
        };
      }
      resolvedHeaders = { ...baseHeaders, ...headersResult.value };
    }

    // 6. Resolve body
    let body: string | undefined;
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    if (methodsWithBody.includes(step.method) && step.bodyTemplate !== undefined) {
      if (typeof step.bodyTemplate === 'string') {
        const bodyResult = resolveTemplate(step.bodyTemplate, context);
        if (bodyResult.errors.length > 0) {
          return {
            name: step.name,
            data: null,
            error: this.stepTemplateError(step.name, 'body', bodyResult.errors),
          };
        }
        body = bodyResult.value;
      } else {
        const bodyResult = resolveTemplateObject(step.bodyTemplate, context);
        if (bodyResult.errors.length > 0) {
          return {
            name: step.name,
            data: null,
            error: this.stepTemplateError(step.name, 'body', bodyResult.errors),
          };
        }
        body = JSON.stringify(bodyResult.value);
      }
    }

    // 7. Make the HTTP request
    let response: Response;
    try {
      response = await httpFetch(fullUrl, {
        method: step.method,
        headers: resolvedHeaders,
        body,
        timeout: step.timeout,
        signal,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort')) {
        return {
          name: step.name,
          data: null,
          error: this.errorResult(
            ToolErrorType.EXECUTION_FAILED,
            `Step "${step.name}": Request timed out after ${step.timeout}ms`,
          ),
        };
      }
      return {
        name: step.name,
        data: null,
        error: this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Step "${step.name}": HTTP request failed: ${message}`,
        ),
      };
    }

    // 8. Handle HTTP errors
    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '';
      }
      const truncated = errorBody.length > 500 ? errorBody.slice(0, 500) + '...' : errorBody;
      return {
        name: step.name,
        data: null,
        error: this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Step "${step.name}": HTTP ${response.status} ${response.statusText}: ${truncated}`,
        ),
      };
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

    // 10. Shape step response if configured
    if (step.responseShaping?.path) {
      const shaped = shapeResponse(responseData, step.responseShaping);
      try {
        responseData = JSON.parse(shaped);
      } catch {
        responseData = shaped;
      }
    }

    return { name: step.name, data: responseData };
  }

  private applyMerge(context: MergeTemplateContext): ToolResult {
    let merged: string;

    if (typeof this.config.merge === 'string') {
      const result = resolveMergeTemplate(this.config.merge, context);
      if (result.errors.length > 0) {
        const errMsg = result.errors
          .map((e) => `  - {{${e.expression}}}: ${e.message}`)
          .join('\n');
        return this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Merge template resolution failed:\n${errMsg}`,
        );
      }
      merged = result.value;
    } else {
      const result = resolveMergeTemplateObject(this.config.merge, context);
      if (result.errors.length > 0) {
        const errMsg = result.errors
          .map((e) => `  - {{${e.expression}}}: ${e.message}`)
          .join('\n');
        return this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          `Merge template resolution failed:\n${errMsg}`,
        );
      }
      merged = JSON.stringify(result.value);
    }

    // Apply final response shaping
    const shaped = shapeResponse(
      merged,
      this.config.responseShaping,
    );

    return {
      llmContent: shaped,
      returnDisplay: shaped,
    };
  }

  private stepTemplateError(
    stepName: string,
    location: string,
    errors: TemplateError[],
  ): ToolResult {
    const msg = `Step "${stepName}": Template resolution failed in ${location}:\n${formatTemplateErrors(errors)}`;
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
 * A declarative chain tool — parallel API calls merged into one response.
 */
export class ChainTool extends BaseDeclarativeTool<ChainToolParams, ToolResult> {
  constructor(
    private readonly chainConfig: ChainToolConfig,
    private readonly connections: ConnectionsMap,
    messageBus: MessageBus,
  ) {
    super(
      chainConfig.name,
      chainConfig.displayName,
      chainConfig.description,
      Kind.Fetch,
      chainConfig.parameters,
      messageBus,
      false, // isOutputMarkdown
      false, // canUpdateOutput
      undefined, // extensionName
      undefined, // extensionId
    );
  }

  protected createInvocation(
    params: ChainToolParams,
    messageBus: MessageBus,
    toolName?: string,
    toolDisplayName?: string,
  ): ToolInvocation<ChainToolParams, ToolResult> {
    return new ChainToolInvocation(
      params,
      messageBus,
      toolName ?? this.name,
      toolDisplayName ?? this.displayName,
      this.chainConfig,
      this.connections,
    );
  }
}
