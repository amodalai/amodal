/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { MessageBus } from '@google/gemini-cli-core';
import type {
  ToolResult,
  ToolCallConfirmationDetails,
  ToolInvocation,
} from '@google/gemini-cli-core';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from '@google/gemini-cli-core';
import type { ToolContext } from '../tool-context.js';
import { PRESENT_TOOL_NAME, WIDGET_TYPES } from './widget-types.js';
import { ToolErrorType } from '@google/gemini-cli-core';
import { getPresentToolDefinition } from '../tools/definitions/amodal-tools.js';
import type { PresentParams } from './widget-types.js';

class PresentInvocation extends BaseToolInvocation<
  PresentParams,
  ToolResult
> {
  constructor(
    private config: ToolContext,
    params: PresentParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `present [${this.params.widget}]`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // No confirmation needed for rendering widgets
    return false;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    // Validate widget type
    const validTypes = WIDGET_TYPES as readonly string[];
    if (!validTypes.includes(this.params.widget)) {
      const errorMessage =
        `Invalid widget type "${this.params.widget}". Must be one of: ${WIDGET_TYPES.join(', ')}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Validate data is an object
    if (!this.params.data || typeof this.params.data !== 'object') {
      const errorMessage = 'Widget data must be a non-null object.';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Validate required fields for input widget types
    if (this.params.widget === 'credential-input') {
      const data = this.params.data;
      if (!data['connection_name'] || !data['app_id'] || !Array.isArray(data['fields'])) {
        const errorMessage = 'credential-input requires connection_name, app_id, and fields array.';
        return {
          llmContent: `Error: ${errorMessage}`,
          returnDisplay: `Error: ${errorMessage}`,
          error: {
            message: errorMessage,
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }
    }

    if (this.params.widget === 'document-preview') {
      const data = this.params.data;
      if (!data['preview_id'] || !data['resource_type'] || !data['title'] || !data['body'] || !data['action']) {
        const errorMessage = 'document-preview requires preview_id, resource_type, title, body, and action.';
        return {
          llmContent: `Error: ${errorMessage}`,
          returnDisplay: `Error: ${errorMessage}`,
          error: {
            message: errorMessage,
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }
    }

    // Log audit event
    const auditLogger = this.config.getAuditLogger();
    if (auditLogger) {
      auditLogger.logToolCall(
        PRESENT_TOOL_NAME,
        { widget: this.params.widget },
        0,
      );
    }

    const successMessage =
      `Widget "${this.params.widget}" presented successfully.`;

    return {
      llmContent: successMessage,
      returnDisplay: successMessage,
    };
  }
}

/**
 * Built-in tool for presenting visual widgets inline in the conversation.
 * Always available regardless of role. The server transforms the tool result
 * into a widget SSE event for the client to render.
 */
export class PresentTool extends BaseDeclarativeTool<
  PresentParams,
  ToolResult
> {
  static readonly Name = PRESENT_TOOL_NAME;

  constructor(
    private config: ToolContext,
    messageBus: MessageBus,
  ) {
    const definition = getPresentToolDefinition();

    super(
      PresentTool.Name,
      'Present Widget',
      definition.base.description!,
      Kind.Other,
      definition.base.parametersJsonSchema,
      messageBus,
      true,
      false,
    );
  }

  protected createInvocation(
    params: PresentParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<PresentParams, ToolResult> {
    return new PresentInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName ?? 'Present Widget',
    );
  }
}
