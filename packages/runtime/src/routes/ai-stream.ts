/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Vercel AI SDK UI Message Stream Protocol adapter.
 *
 * Accepts requests in the Vercel AI SDK format, feeds the user message into
 * the existing `streamMessage()` async generator, and translates every
 * `SSEEvent` into the UI Message Stream Protocol that `@ai-sdk/react`'s
 * `useChat` hook expects.
 *
 * Protocol spec: events are newline-delimited JSON objects prefixed with
 * `data: `, terminated by `data: [DONE]\n\n`.  The response MUST include the
 * `x-vercel-ai-ui-message-stream: v1` header.
 */

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/request-validation.js';
import { getAuthContext } from '../middleware/auth.js';
import type { AuthContext } from '../middleware/auth.js';
import type { SessionManager } from '../session/session-manager.js';
import { streamMessage, type StreamHooks } from '../session/session-runner.js';
import { SSEEventType, type SSEEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Request schema (Vercel AI SDK message format)
// ---------------------------------------------------------------------------

const AIMessagePartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const AIMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(AIMessagePartSchema).optional(),
  content: z.string().optional(),
});

export const AIStreamRequestSchema = z.object({
  messages: z.array(AIMessageSchema).min(1),
  session_id: z.string().optional(),
  role: z.string().optional(),
  deploy_id: z.string().optional(),
});

export type AIStreamRequest = z.infer<typeof AIStreamRequestSchema>;

// ---------------------------------------------------------------------------
// UI Message Stream event types
// ---------------------------------------------------------------------------

interface UIMessageStart {
  type: 'message-start';
  messageId: string;
}

interface UIStartStep {
  type: 'start-step';
}

interface UIFinishStep {
  type: 'finish-step';
}

interface UIFinish {
  type: 'finish';
  finishReason: 'stop' | 'error' | 'other';
}

interface UITextStart {
  type: 'text-start';
  id: string;
}

interface UITextDelta {
  type: 'text-delta';
  id: string;
  delta: string;
}

interface UITextEnd {
  type: 'text-end';
  id: string;
}

interface UIToolInputStart {
  type: 'tool-input-start';
  toolCallId: string;
  toolName: string;
}

interface UIToolInputAvailable {
  type: 'tool-input-available';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface UIToolOutputAvailable {
  type: 'tool-output-available';
  toolCallId: string;
  output: Record<string, unknown>;
}

interface UIToolOutputError {
  type: 'tool-output-error';
  toolCallId: string;
  errorText: string;
}

interface UIDataPart {
  type: string;
  id?: string;
  data: Record<string, unknown>;
}

interface UIError {
  type: 'error';
  errorText: string;
}

type UIStreamEvent =
  | UIMessageStart
  | UIStartStep
  | UIFinishStep
  | UIFinish
  | UITextStart
  | UITextDelta
  | UITextEnd
  | UIToolInputStart
  | UIToolInputAvailable
  | UIToolOutputAvailable
  | UIToolOutputError
  | UIDataPart
  | UIError;

// ---------------------------------------------------------------------------
// Adapter: translate SSEEvent → UIStreamEvent[]
// ---------------------------------------------------------------------------

interface AdapterState {
  messageId: string;
  textBlockOpen: boolean;
  textBlockId: string;
  textBlockCounter: number;
}

function createAdapterState(): AdapterState {
  return {
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    textBlockOpen: false,
    textBlockId: '',
    textBlockCounter: 0,
  };
}

function closeTextBlock(state: AdapterState): UITextEnd | null {
  if (!state.textBlockOpen) return null;
  state.textBlockOpen = false;
  return { type: 'text-end', id: state.textBlockId };
}

/**
 * Translate a single `SSEEvent` into one or more `UIStreamEvent`s.
 *
 * The `state` parameter is mutated across calls to track whether a text
 * block is currently open.
 */
export function translateEvent(
  event: SSEEvent,
  state: AdapterState,
): UIStreamEvent[] {
  const out: UIStreamEvent[] = [];

  switch (event.type) {
    case SSEEventType.Init: {
      out.push({ type: 'message-start', messageId: state.messageId });
      out.push({ type: 'start-step' });
      break;
    }

    case SSEEventType.TextDelta: {
      if (!state.textBlockOpen) {
        state.textBlockCounter++;
        state.textBlockId = `text-${state.textBlockCounter}`;
        state.textBlockOpen = true;
        out.push({ type: 'text-start', id: state.textBlockId });
      }
      out.push({
        type: 'text-delta',
        id: state.textBlockId,
        delta: event.content,
      });
      break;
    }

    case SSEEventType.ToolCallStart: {
      const closed = closeTextBlock(state);
      if (closed) out.push(closed);
      out.push({
        type: 'tool-input-start',
        toolCallId: event.tool_id,
        toolName: event.tool_name,
      });
      out.push({
        type: 'tool-input-available',
        toolCallId: event.tool_id,
        toolName: event.tool_name,
        input: event.parameters,
      });
      break;
    }

    case SSEEventType.ToolCallResult: {
      if (event.status === 'error') {
        out.push({
          type: 'tool-output-error',
          toolCallId: event.tool_id,
          errorText: event.error ?? 'Tool call failed',
        });
      } else {
        out.push({
          type: 'tool-output-available',
          toolCallId: event.tool_id,
          output: { result: event.result ?? '' },
        });
      }
      break;
    }

    case SSEEventType.SubagentEvent: {
      out.push({
        type: 'data-subagent',
        data: {
          parent_tool_id: event.parent_tool_id,
          agent_name: event.agent_name,
          event_type: event.event_type,
          tool_name: event.tool_name,
          result: event.result,
          text: event.text,
          error: event.error,
        },
      });
      break;
    }

    case SSEEventType.SkillActivated: {
      out.push({
        type: 'data-skill-activated',
        data: { skill_name: event.skill_name },
      });
      break;
    }

    case SSEEventType.Widget: {
      out.push({
        type: 'data-widget',
        data: { widget_type: event.widget_type, data: event.data },
      });
      break;
    }

    case SSEEventType.KBProposal: {
      out.push({
        type: 'data-kb-proposal',
        data: {
          proposal_id: event.proposal_id,
          scope: event.scope,
          title: event.title,
          reasoning: event.reasoning,
          status: event.status,
        },
      });
      break;
    }

    case SSEEventType.AskUser: {
      // Question[] needs to go into a generic Record<string, unknown> data part
      const askData: Record<string, unknown> = {
        ask_id: event.ask_id,
        questions: event.questions,
      };
      out.push({ type: 'data-ask-user', data: askData });
      break;
    }

    case SSEEventType.CredentialSaved: {
      out.push({
        type: 'data-credential-saved',
        data: { connection_name: event.connection_name },
      });
      break;
    }

    case SSEEventType.Approved: {
      out.push({
        type: 'data-approved',
        data: {
          resource_type: event.resource_type,
          preview_id: event.preview_id,
        },
      });
      break;
    }

    case SSEEventType.Error: {
      out.push({ type: 'error', errorText: event.message });
      break;
    }

    case SSEEventType.Done: {
      const closed = closeTextBlock(state);
      if (closed) out.push(closed);
      out.push({ type: 'finish-step' });
      out.push({ type: 'finish', finishReason: 'stop' });
      break;
    }

    default:
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Extract the user message text from the AI SDK request
// ---------------------------------------------------------------------------

export function extractUserMessage(messages: AIStreamRequest['messages']): string {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return '';

  // Try parts-based format first (AI SDK v4+)
  if (lastMessage.parts) {
    const textPart = lastMessage.parts.find((p) => p.type === 'text');
    if (textPart?.text) return textPart.text;
  }

  // Fall back to content string (AI SDK v3 / plain format)
  if (lastMessage.content) return lastMessage.content;

  return '';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface AIStreamRouterOptions {
  sessionManager: SessionManager;
  /** Factory that builds per-request stream hooks from the auth context */
  createStreamHooks?: (auth?: AuthContext) => StreamHooks;
}

export function createAIStreamRouter(options: AIStreamRouterOptions): Router {
  const router = Router();

  router.post(
    '/chat/ai-stream',
    validate(AIStreamRequestSchema),
    async (req, res, next) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated by Zod middleware
        const body = req.body as AIStreamRequest;
        const message = extractUserMessage(body.messages);

        if (!message) {
          res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'No user message found in messages array' },
          });
          return;
        }

        const sessionId = body.session_id;
        const role = body.role;
        const deployId = body.deploy_id;

        // Session lookup/creation — same logic as chat-stream.ts
        let session;
        if (sessionId) {
          session = options.sessionManager.get(sessionId);
          if (!session) {
            const auth = getAuthContext(res);
            session = await options.sessionManager.hydrate(sessionId, role, auth);
          }
          if (!session) {
            const auth = getAuthContext(res);
            session = await options.sessionManager.create(role, auth, undefined, undefined, deployId);
          }
        } else {
          const auth = getAuthContext(res);
          session = await options.sessionManager.create(role, auth, undefined, undefined, deployId);
        }

        // Set up SSE headers with Vercel AI SDK protocol marker
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-vercel-ai-ui-message-stream', 'v1');
        res.flushHeaders();

        const controller = new AbortController();
        res.on('close', () => controller.abort());

        // Build per-request hooks with auth context
        const hooks = options.createStreamHooks?.(getAuthContext(res));

        const stream = streamMessage(
          session,
          message,
          controller.signal,
          hooks,
          options.sessionManager,
        );

        const state = createAdapterState();

        for await (const event of stream) {
          if (controller.signal.aborted) break;

          const uiEvents = translateEvent(event, state);
          for (const uiEvent of uiEvents) {
            res.write(`data: ${JSON.stringify(uiEvent)}\n\n`);
          }
        }

        // Terminal sentinel
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        if (res.headersSent) {
          const errorEvent: UIError = {
            type: 'error',
            errorText: err instanceof Error ? err.message : 'Unknown error',
          };
          res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          next(err);
        }
      }
    },
  );

  return router;
}
