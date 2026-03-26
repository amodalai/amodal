/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export interface ToolCallInfo {
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  result?: string;
  error?: string;
  durationMs?: number;
  subagentEvents?: SubagentEventInfo[];
}

export interface SubagentEventInfo {
  agentName: string;
  eventType: string;
  toolName?: string;
  text?: string;
  error?: string;
}

export interface AskUserQuestion {
  askId: string;
  text: string;
}

export interface KBProposalInfo {
  proposalId: string;
  scope: string;
  title: string;
  reasoning: string;
  status: string;
}

export interface NotificationInfo {
  id: string;
  type: 'credential_saved' | 'approved' | 'kb_proposal' | 'field_scrub' | 'info' | 'warning';
  message: string;
  timestamp: number;
}

export interface ExplorePhase {
  query: string;
  active: boolean;
  summary?: string;
  tokensUsed?: number;
}

export interface ConfirmationRequest {
  endpoint: string;
  method: string;
  reason: string;
  escalated: boolean;
}

export interface TokenUsageInfo {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  model: string | null;
  turnCount: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  text: string;
  tool_calls?: Array<{
    tool_name: string;
    tool_id: string;
    args: Record<string, unknown>;
    status: 'success' | 'error';
    result?: string;
    error?: string;
    duration_ms?: number;
  }>;
  skills?: string[];
  thinking?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCallInfo[];
  skills?: string[];
  thinking?: string;
}

export type ChatAction =
  | {type: 'SEND_MESSAGE'; text: string}
  | {type: 'INIT'; sessionId: string}
  | {type: 'TEXT_DELTA'; content: string}
  | {
      type: 'TOOL_CALL_START';
      toolId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'TOOL_CALL_RESULT';
      toolId: string;
      status: 'success' | 'error';
      result?: string;
      error?: string;
      durationMs?: number;
    }
  | {
      type: 'SUBAGENT_EVENT';
      parentToolId: string;
      agentName: string;
      eventType: string;
      toolName?: string;
      text?: string;
      error?: string;
    }
  | {type: 'SKILL_ACTIVATED'; skillName: string}
  | {type: 'ERROR'; message: string}
  | {type: 'DONE'}
  | {type: 'THINKING_DELTA'; content: string}
  | {type: 'ASK_USER'; askId: string; questions: Array<{text: string}>}
  | {type: 'ASK_USER_RESPOND'; askId: string; answer: string}
  | {type: 'KB_PROPOSAL'; proposal: KBProposalInfo}
  | {type: 'NOTIFICATION'; notification: NotificationInfo}
  | {type: 'EXPLORE_START'; query: string}
  | {type: 'EXPLORE_END'; summary: string; tokensUsed: number}
  | {type: 'CONFIRMATION_REQUIRED'; request: ConfirmationRequest}
  | {type: 'CONFIRMATION_RESPOND'; approved: boolean}
  | {type: 'DISMISS_NOTIFICATION'; id: string}
  | {type: 'TOKEN_USAGE'; inputTokens: number; outputTokens: number; model?: string}
  | {type: 'RESUME_SESSION'; sessionId: string; messages: ChatMessage[]}
  | {type: 'CLEAR_HISTORY'}
  | {type: 'LOCAL_MESSAGE'; text: string}
  | {type: 'SHOW_SESSION_BROWSER'}
  | {type: 'HIDE_SESSION_BROWSER'};

export interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  streamingText: string;
  activeToolCalls: ToolCallInfo[];
  activatedSkills: string[];
  isStreaming: boolean;
  error: string | null;
  thinkingText: string;
  pendingQuestion: AskUserQuestion | null;
  pendingConfirmation: ConfirmationRequest | null;
  confirmationQueue: ConfirmationRequest[];
  notifications: NotificationInfo[];
  explorePhase: ExplorePhase | null;
  kbProposals: KBProposalInfo[];
  tokenUsage: TokenUsageInfo;
  showSessionBrowser: boolean;
}
