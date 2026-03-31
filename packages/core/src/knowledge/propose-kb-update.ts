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
import { PROPOSE_KNOWLEDGE_TOOL_NAME } from '../tools/amodal-tool-names.js';
import { ToolErrorType } from '@google/gemini-cli-core';
import { getProposeKnowledgeDefinition } from '../tools/definitions/amodal-tools.js';
/**
 * Parameters for the propose_kb_update tool.
 */
export interface ProposeKBUpdateParams {
  action: 'create' | 'update';
  scope: 'application';
  document_id?: string;
  title: string;
  category: 'system_docs' | 'methodology' | 'patterns' | 'false_positives' | 'response_procedures' | 'environment' | 'baselines' | 'team' | 'incident_history' | 'working_memory';
  body: string;
  reasoning: string;
}

/**
 * Response shape from the platform API when creating a proposed update.
 */
interface ProposalResponse {
  id: string;
  status: string;
}

class ProposeKBUpdateInvocation extends BaseToolInvocation<
  ProposeKBUpdateParams,
  ToolResult
> {
  constructor(
    private config: ToolContext,
    params: ProposeKBUpdateParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `propose_kb_update [${this.params.scope}]: ${this.params.title}`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Proposals are reviewed by admins, not user-confirmed
    return false;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const platformApiUrl = this.config.getPlatformApiUrl();
    const platformApiKey = this.config.getPlatformApiKey();

    if (!platformApiUrl || !platformApiKey) {
      const errorMessage =
        'Platform API credentials not configured. Cannot propose knowledge base updates.';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Resolve scope_id from applicationId
    const scopeId = this.config.getApplicationId();

    if (!scopeId) {
      const errorMessage = 'Application ID not configured. Cannot propose application-level updates.';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Validate update action requires document_id
    if (this.params.action === 'update' && !this.params.document_id) {
      const errorMessage =
        'document_id is required for update actions.';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      scope_type: this.params.scope,
      scope_id: scopeId,
      session_id: this.config.getSessionId(),
      proposed_title: this.params.title,
      proposed_category: this.params.category,
      proposed_body: this.params.body,
      reasoning: this.params.reasoning,
    };

    if (this.params.document_id) {
      requestBody['document_id'] = this.params.document_id;
    }

    try {
      const response = await fetch(
        `${platformApiUrl}/api/proposed-updates`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${platformApiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: _signal,
        },
      );

      if (!response.ok) {
        const errorMessage = `Platform API returned ${String(response.status)}: ${response.statusText}`;
        return {
          llmContent: `Error: ${errorMessage}`,
          returnDisplay: `Error: ${errorMessage}`,
          error: {
            message: errorMessage,
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response shape is trusted
      const result = (await response.json()) as unknown as ProposalResponse;

      // Log audit event
      const auditLogger = this.config.getAuditLogger();
      if (auditLogger) {
        auditLogger.logKbProposal(
          this.params.scope,
          this.params.title,
          result.id,
        );
      }

      const successMessage =
        `Knowledge base update proposed successfully.\n` +
        `Proposal ID: ${result.id}\n` +
        `Scope: ${this.params.scope}\n` +
        `Title: ${this.params.title}\n` +
        `Status: pending admin review`;

      return {
        llmContent: successMessage,
        returnDisplay: successMessage,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMessage = `Failed to submit proposal: ${message}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

/**
 * Built-in tool for proposing knowledge base updates during conversations.
 * Always available when platform API credentials are configured.
 * Not subject to role filtering.
 */
export class ProposeKBUpdateTool extends BaseDeclarativeTool<
  ProposeKBUpdateParams,
  ToolResult
> {
  static readonly Name = PROPOSE_KNOWLEDGE_TOOL_NAME;

  constructor(
    private config: ToolContext,
    messageBus: MessageBus,
  ) {
    const definition = getProposeKnowledgeDefinition();

    super(
      ProposeKBUpdateTool.Name,
      'Propose KB Update',
      definition.base.description!,
      Kind.Other,
      definition.base.parametersJsonSchema,
      messageBus,
      true,
      false,
    );
  }

  protected createInvocation(
    params: ProposeKBUpdateParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<ProposeKBUpdateParams, ToolResult> {
    return new ProposeKBUpdateInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName ?? 'Propose KB Update',
    );
  }
}
