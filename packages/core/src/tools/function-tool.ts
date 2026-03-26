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
import type {
  FunctionToolConfig,
  FunctionToolHandler,
  FunctionToolContext,
} from './function-tool-types.js';
import type { ConnectionsMap } from '../templates/connections.js';
import type { MessageBus } from '@google/gemini-cli-core';
import { shapeResponse } from './tool-utils.js';

type FunctionToolParams = Record<string, unknown>;

/**
 * Invocation for a function tool call — executes a custom handler.
 */
export class FunctionToolInvocation extends BaseToolInvocation<
  FunctionToolParams,
  ToolResult
> {
  constructor(
    params: FunctionToolParams,
    messageBus: MessageBus,
    toolName: string,
    toolDisplayName: string,
    private readonly config: FunctionToolConfig,
    private readonly handler: FunctionToolHandler,
    private readonly connections: ConnectionsMap,
  ) {
    super(params, messageBus, toolName, toolDisplayName);
  }

  getDescription(): string {
    return `Function: ${this.config.handler}`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const context: FunctionToolContext = {
      fetch: globalThis.fetch.bind(globalThis),
      connections: this.connections,
    };

    // Execute with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    // Forward external abort
    if (signal.aborted) {
      clearTimeout(timeoutId);
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        'Function aborted before execution',
      );
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const resultPromise = this.handler(this.params, context);

      // Race against timeout
      const result = await Promise.race([
        resultPromise,
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Function handler timed out after ${this.config.timeout}ms`));
          }, { once: true });
        }),
      ]);

      // Shape response
      const shaped = shapeResponse(result, this.config.responseShaping);

      return {
        llmContent: shaped,
        returnDisplay: shaped,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('timed out')) {
        return this.errorResult(
          ToolErrorType.EXECUTION_FAILED,
          message,
        );
      }
      return this.errorResult(
        ToolErrorType.EXECUTION_FAILED,
        `Function handler "${this.config.handler}" failed: ${message}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
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
 * A function tool — executes a custom handler from the version bundle.
 * Uses Kind.Execute which triggers confirmation via MUTATOR_KINDS.
 */
export class FunctionTool extends BaseDeclarativeTool<FunctionToolParams, ToolResult> {
  constructor(
    private readonly functionConfig: FunctionToolConfig,
    private readonly handler: FunctionToolHandler,
    private readonly connections: ConnectionsMap,
    messageBus: MessageBus,
  ) {
    super(
      functionConfig.name,
      functionConfig.displayName,
      functionConfig.description,
      Kind.Execute,
      functionConfig.parameters,
      messageBus,
      false, // isOutputMarkdown
      false, // canUpdateOutput
      undefined, // extensionName
      undefined, // extensionId
    );
  }

  protected createInvocation(
    params: FunctionToolParams,
    messageBus: MessageBus,
    toolName?: string,
    toolDisplayName?: string,
  ): ToolInvocation<FunctionToolParams, ToolResult> {
    return new FunctionToolInvocation(
      params,
      messageBus,
      toolName ?? this.name,
      toolDisplayName ?? this.displayName,
      this.functionConfig,
      this.handler,
      this.connections,
    );
  }
}
