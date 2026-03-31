/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {
  GeminiEventType,
  ToolErrorType,
  type MessageBusType,
  PRESENT_TOOL_NAME,
  ACTIVATE_SKILL_TOOL_NAME,
  ASK_USER_TOOL_NAME,
  type ToolCallRequestInfo,
  type CompletedToolCall,
  type Content,
  type Part,
  type Question,
} from '@amodalai/core';

/** Shape emitted by our dispatch tool on the message bus. */
interface SubagentActivityMessage {
  agentName: string;
  eventType: string;
  dispatchId: string;
  data: Record<string, unknown>;
}

/**
 * Custom message bus event key for subagent activity.
 * Upstream MessageBusType doesn't include this — our dispatch tool emits on
 * this string key, which works because MessageBus extends EventEmitter.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- custom event key for our dispatch tool
const SUBAGENT_ACTIVITY_EVENT = 'subagent-activity' as MessageBusType;
import type { ManagedSession, SessionManager, SessionMessage } from './session-manager.js';
import {
  SSEEventType,
  type ChatResponse,
  type ToolCallSummary,
  type SSEEvent,
  type SSESubagentEvent,
} from '../types.js';
import type { AuditClient } from '../audit/audit-client.js';

const MAX_TURNS = 50;
const MAX_RESULT_LENGTH = 2000;

/**
 * Extract text from tool response parts, truncated for audit logging.
 * Handles both plain text parts and functionResponse parts (from task agents).
 */
function extractResultText(parts: Part[] | undefined): string | undefined {
  if (!parts || parts.length === 0) return undefined;
  const segments: string[] = [];
  for (const p of parts) {
    if (p.text) {
      segments.push(p.text);
    } else if (p.functionResponse?.response) {
      try {
        segments.push(JSON.stringify(p.functionResponse.response));
      } catch {
        segments.push('[unserializable response]');
      }
    }
  }
  const text = segments.join('');
  if (!text) return undefined;
  return text.length > MAX_RESULT_LENGTH
    ? text.slice(0, MAX_RESULT_LENGTH) + '...[truncated]'
    : text;
}

const MAX_SUBAGENT_RESULT_LENGTH = 300;

/**
 * Map SubagentActivityEvent type strings to SSE event_type values.
 */
function mapSubagentEventType(type: string): SSESubagentEvent['event_type'] {
  switch (type) {
    case 'TOOL_CALL_START': return 'tool_call_start';
    case 'TOOL_CALL_END': return 'tool_call_end';
    case 'THOUGHT_CHUNK': return 'thought';
    case 'COMPLETE': return 'complete';
    case 'ERROR': return 'error';
    default: return 'error';
  }
}

/**
 * Truncate a string to the given max length, appending '...' if truncated.
 */
function truncateSubagentResult(text: string | undefined, maxLen: number): string | undefined {
  if (!text) return undefined;
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

/**
 * Convert a real-time SubagentActivityMessage to an SSESubagentEvent.
 */
function subagentMessageToSSE(
  msg: SubagentActivityMessage,
  parentToolId: string,
): SSESubagentEvent {
  return {
    type: SSEEventType.SubagentEvent,
    parent_tool_id: parentToolId,
    agent_name: msg.agentName,
    event_type: mapSubagentEventType(msg.eventType),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- name from subagent activity data
    tool_name: msg.data['name'] as string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- args from subagent activity data
    tool_args: msg.data['args'] as Record<string, unknown> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- output from subagent activity data
    result: truncateSubagentResult(msg.data['output'] as string | undefined, MAX_SUBAGENT_RESULT_LENGTH),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- text from subagent COMPLETE event
    text: msg.data['text'] as string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error from subagent activity data
    error: msg.data['error'] as string | undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Audit context for logging chat events to the platform API.
 */
export interface StreamAuditContext {
  auditClient: AuditClient;
  appId: string;
  token: string;
  orgId?: string;
  actor?: string;
  /** Platform API URL for session history persistence */
  platformApiUrl?: string;
}


interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/**
 * Fire-and-forget POST to platform-api to report usage.
 * Never blocks the chat stream — errors are logged to stderr.
 */
function reportUsage(
  audit: StreamAuditContext,
  model: string,
  taskAgentRuns: number,
  tokens: TokenCounts,
): void {
  if (!audit.platformApiUrl || !audit.orgId) return;

  const url = `${audit.platformApiUrl}/api/orgs/${audit.orgId}/usage`;
  const body = JSON.stringify({
    model,
    api_calls: 1,
    chat_sessions: 1,
    task_agent_runs: taskAgentRuns,
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cached_tokens: tokens.cachedTokens,
  });

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env['INTERNAL_API_KEY']
        ? { 'X-Internal-Key': process.env['INTERNAL_API_KEY'] }
        : {}),
    },
    body,
  }).catch((err: unknown) => {
    process.stderr.write(
      `[USAGE] Failed to report usage for org ${audit.orgId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });
}

/**
 * Fire-and-forget POST to platform-api to persist session history.
 * Never blocks the chat stream — errors are logged to stderr.
 */
function saveSessionHistory(
  audit: StreamAuditContext,
  sessionId: string,
  messages: SessionMessage[],
  status: 'active' | 'completed' | 'error',
  sessionMeta?: { model?: string; provider?: string },
): void {
  if (!audit.platformApiUrl || !audit.appId) return;

  const url = `${audit.platformApiUrl}/api/applications/${audit.appId}/sessions`;
  const body = JSON.stringify({
    id: sessionId,
    app_id: audit.appId,
    actor: audit.actor,
    messages,
    status,
    // Persist model/provider so hydrated sessions use the same model
    ...(sessionMeta?.model ? { model: sessionMeta.model } : {}),
    ...(sessionMeta?.provider ? { provider: sessionMeta.provider } : {}),
  });

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${audit.token}`,
    },
    body,
  }).catch((err: unknown) => {
    process.stderr.write(
      `[SESSION-HISTORY] Failed to save session ${sessionId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });
}

/**
 * Run a synchronous (non-streaming) message through the agentic loop.
 * Collects all text and tool calls, returns a ChatResponse.
 */
export async function runMessage(
  session: ManagedSession,
  message: string,
  signal: AbortSignal,
  audit?: StreamAuditContext,
): Promise<ChatResponse> {
  const { geminiClient, scheduler, config } = session;
  const promptId = `msg-${Date.now()}`;
  const sessionStartMs = Date.now();
  let currentMessages: Content[] = [
    { role: 'user', parts: [{ text: message }] },
  ];

  let responseText = '';
  const toolCalls: ToolCallSummary[] = [];
  const skillsActivated: string[] = [];
  let turnCount = 0;
  let status: 'completed' | 'error' | 'max_turns' = 'completed';
  let errorMessage: string | undefined;
  const tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  try {
    while (true) {
      turnCount++;
      if (turnCount > MAX_TURNS) {
        status = 'max_turns';
        break;
      }

      if (signal.aborted) break;

      const toolCallRequests: ToolCallRequestInfo[] = [];
      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts ?? [],
        signal,
        promptId,
        undefined,
        false,
        turnCount === 1 ? message : undefined,
      );

      for await (const event of responseStream) {
        if (signal.aborted) break;

        if (event.type === GeminiEventType.Content) {
          responseText += event.value;
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
        } else if (event.type === GeminiEventType.Finished) {
          const meta = event.value.usageMetadata;
          if (meta) {
            tokens.inputTokens += meta.promptTokenCount ?? 0;
            tokens.outputTokens += meta.candidatesTokenCount ?? 0;
            tokens.cachedTokens += meta.cachedContentTokenCount ?? 0;
          }
        } else if (event.type === GeminiEventType.Error) {
          status = 'error';
          const errObj = event.value.error;
            const errMsg = errObj instanceof Error ? errObj.message : (typeof errObj === 'object' && errObj !== null && 'message' in errObj) ? String((errObj as Record<string, unknown>)['message']) : String(errObj);
          errorMessage = errMsg;
          throw new Error(errMsg);
        } else if (event.type === GeminiEventType.AgentExecutionStopped) {
          return { session_id: session.id, response: responseText, tool_calls: toolCalls };
        }
      }

      if (toolCallRequests.length > 0) {
        const completedToolCalls = await scheduler.schedule(
          toolCallRequests,
          signal,
        );

        const toolResponseParts: Part[] = [];

        for (const completed of completedToolCalls) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing optional field on CompletedToolCall union
          const duration = 'durationMs' in completed ? (completed as unknown as Record<string, number>)['durationMs'] : undefined;

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- inner_tool_calls from subagent data
          const innerCalls = completed.response.data?.['inner_tool_calls'] as Array<Record<string, unknown>> | undefined;

          toolCalls.push({
            tool_name: completed.request.name,
            tool_id: completed.request.callId,
            args: completed.request.args,
            status: completed.response.error ? 'error' : 'success',
            duration_ms: duration,
            error: completed.response.error?.message,
            result: extractResultText(completed.response.responseParts),
            inner_tool_calls: innerCalls,
          });

          // Track skill activations
          if (
            completed.request.name === ACTIVATE_SKILL_TOOL_NAME &&
            !completed.response.error
          ) {
            const skillName = String(completed.request.args['name'] ?? '');
            if (skillName) {
              skillsActivated.push(skillName);
            }
          }

          if (completed.response.responseParts) {
            toolResponseParts.push(...completed.response.responseParts);
          }

          // Record tool calls
          try {
            const currentModel =
              geminiClient.getCurrentSequenceModel() ?? config.getModel();
            geminiClient
              .getChat()
              .recordCompletedToolCalls(currentModel, completedToolCalls);
          } catch {
            // Non-critical — continue
          }
        }

        // Check for stop execution
        const stopTool = completedToolCalls.find(
          (tc) => tc.response.errorType === ToolErrorType.STOP_EXECUTION,
        );
        if (stopTool) {
          return { session_id: session.id, response: responseText, tool_calls: toolCalls };
        }

        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        break;
      }
    }

    return { session_id: session.id, response: responseText, tool_calls: toolCalls };
  } catch (err) {
    status = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    if (audit) {
      const model = geminiClient.getCurrentSequenceModel() ?? config.getModel();
      logSessionCompleted(audit, session.id, message, responseText, turnCount, toolCalls, skillsActivated, status, errorMessage, sessionStartMs, model, tokens);
    }
  }
}

/**
 * Stream a message through the agentic loop, yielding SSE events.
 */
export async function* streamMessage(
  session: ManagedSession,
  message: string,
  signal: AbortSignal,
  audit?: StreamAuditContext,
  sessionManager?: SessionManager,
): AsyncGenerator<SSEEvent> {
  const { geminiClient, scheduler, config } = session;
  const promptId = `msg-${Date.now()}`;
  const sessionStartMs = Date.now();
  let currentMessages: Content[] = [
    { role: 'user', parts: [{ text: message }] },
  ];

  // Accumulators for the consolidated audit event
  const auditToolCalls: ToolCallSummary[] = [];
  const skillsActivated: string[] = [];
  const widgetEvents: Array<{ widgetType: string; data: Record<string, unknown> }> = [];
  let responseText = '';
  let auditStatus: 'completed' | 'error' | 'max_turns' = 'completed';
  const tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  // Track content block ordering so history can reconstruct the correct interleave
  const contentBlockOrder: Array<Record<string, unknown>> = [];
  function trackText(text: string): void {
    const last = contentBlockOrder[contentBlockOrder.length - 1];
    if (last && last['type'] === 'text') {
      last['text'] = String(last['text'] ?? '') + text;
    } else {
      contentBlockOrder.push({ type: 'text', text });
    }
  }
  function trackToolCall(callId: string): void {
    const last = contentBlockOrder[contentBlockOrder.length - 1];
    if (last && last['type'] === 'tool_calls') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extending callIds array
      (last['callIds'] as string[]).push(callId);
    } else {
      contentBlockOrder.push({ type: 'tool_calls', callIds: [callId] });
    }
  }
  let auditError: string | undefined;

  // Accumulate user message for session history
  const userMsg: SessionMessage = {
    type: 'user',
    id: `msg-${Date.now()}`,
    text: message,
    timestamp: new Date().toISOString(),
  };
  session.accumulatedMessages.push(userMsg);

  yield {
    type: SSEEventType.Init,
    session_id: session.id,
    timestamp: new Date().toISOString(),
  };

  let turnCount = 0;

  while (true) {
    turnCount++;
    if (turnCount > MAX_TURNS) {
      auditStatus = 'max_turns';
      auditError = 'Maximum turns exceeded';
      yield {
        type: SSEEventType.Error,
        message: 'Maximum turns exceeded',
        timestamp: new Date().toISOString(),
      };
      break;
    }

    if (signal.aborted) break;

    const toolCallRequests: ToolCallRequestInfo[] = [];
    const responseStream = geminiClient.sendMessageStream(
      currentMessages[0]?.parts ?? [],
      signal,
      promptId,
      undefined,
      false,
      turnCount === 1 ? message : undefined,
    );

    for await (const event of responseStream) {
      if (signal.aborted) break;

      if (event.type === GeminiEventType.Content) {
        responseText += event.value;
        trackText(event.value);
        yield {
          type: SSEEventType.TextDelta,
          content: event.value,
          timestamp: new Date().toISOString(),
        };
      } else if (event.type === GeminiEventType.ToolCallRequest) {
        // Suppress tool_call_start for present (widget events replace it) and ask_user (intercepted below)
        if (event.value.name !== PRESENT_TOOL_NAME && event.value.name !== ASK_USER_TOOL_NAME) {
          yield {
            type: SSEEventType.ToolCallStart,
            tool_name: event.value.name,
            tool_id: event.value.callId,
            parameters: event.value.args,
            timestamp: new Date().toISOString(),
          };
        }
        toolCallRequests.push(event.value);
      } else if (event.type === GeminiEventType.Finished) {
        const meta = event.value.usageMetadata;
        if (meta) {
          tokens.inputTokens += meta.promptTokenCount ?? 0;
          tokens.outputTokens += meta.candidatesTokenCount ?? 0;
          tokens.cachedTokens += meta.cachedContentTokenCount ?? 0;
        }
      } else if (event.type === GeminiEventType.Error) {
        auditStatus = 'error';
        const errObj = event.value.error;
        const errMsg = errObj instanceof Error ? errObj.message : (typeof errObj === 'object' && errObj !== null && 'message' in errObj) ? String((errObj as Record<string, unknown>)['message']) : String(errObj);
        auditError = errMsg;
        yield {
          type: SSEEventType.Error,
          message: errMsg,
          timestamp: new Date().toISOString(),
        };
        logSessionCompleted(audit, session.id, message, responseText, turnCount, auditToolCalls, skillsActivated, auditStatus, auditError, sessionStartMs, geminiClient.getCurrentSequenceModel() ?? config.getModel(), tokens);
        accumulateAssistantAndSave(session, audit, responseText, auditToolCalls, skillsActivated, widgetEvents, contentBlockOrder, 'error');
        yield {
          type: SSEEventType.Done,
          timestamp: new Date().toISOString(),
          usage: {
            input_tokens: tokens.inputTokens,
            output_tokens: tokens.outputTokens,
            cached_tokens: tokens.cachedTokens,
            total_tokens: tokens.inputTokens + tokens.outputTokens,
          },
        };
        return;
      } else if (event.type === GeminiEventType.AgentExecutionStopped) {
        logSessionCompleted(audit, session.id, message, responseText, turnCount, auditToolCalls, skillsActivated, auditStatus, auditError, sessionStartMs, geminiClient.getCurrentSequenceModel() ?? config.getModel(), tokens);
        accumulateAssistantAndSave(session, audit, responseText, auditToolCalls, skillsActivated, widgetEvents, contentBlockOrder, 'completed');
        yield {
          type: SSEEventType.Done,
          timestamp: new Date().toISOString(),
          usage: {
            input_tokens: tokens.inputTokens,
            output_tokens: tokens.outputTokens,
            cached_tokens: tokens.cachedTokens,
            total_tokens: tokens.inputTokens + tokens.outputTokens,
          },
        };
        return;
      }
    }

    if (toolCallRequests.length > 0) {
      // Partition: separate ask_user requests from regular tool calls
      const askUserRequests = toolCallRequests.filter(
        (req) => req.name === ASK_USER_TOOL_NAME,
      );
      const otherRequests = toolCallRequests.filter(
        (req) => req.name !== ASK_USER_TOOL_NAME,
      );

      const toolResponseParts: Part[] = [];

      // Handle ask_user requests: yield SSE event, wait for user response
      if (askUserRequests.length > 0 && sessionManager) {
        for (const askReq of askUserRequests) {
          const askId = askReq.callId;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- LLM-provided questions array
          const questions = (askReq.args['questions'] as Question[]) ?? [];
          const askStartMs = Date.now();

          // Emit tool_call_start for the ask_user tool
          yield {
            type: SSEEventType.ToolCallStart,
            tool_name: askReq.name,
            tool_id: askId,
            parameters: askReq.args,
            timestamp: new Date().toISOString(),
          };

          // Track ask_user in content block ordering
          contentBlockOrder.push({ type: 'ask_user', askId });

          // Emit ask_user SSE event
          yield {
            type: SSEEventType.AskUser,
            ask_id: askId,
            questions,
            timestamp: new Date().toISOString(),
          };

          try {
            const answers = await sessionManager.waitForAskUserResponse(
              session,
              askId,
              signal,
            );

            const askDuration = Date.now() - askStartMs;
            const resultOutput = JSON.stringify({ answers });

            // Audit
            auditToolCalls.push({
              tool_name: askReq.name,
              tool_id: askId,
              args: askReq.args,
              status: 'success',
              duration_ms: askDuration,
            });

            // Emit tool_call_result
            yield {
              type: SSEEventType.ToolCallResult,
              tool_id: askId,
              status: 'success',
              result: resultOutput.slice(0, 500),
              duration_ms: askDuration,
              timestamp: new Date().toISOString(),
            };

            // Build function response part
            toolResponseParts.push({
              functionResponse: {
                id: askId,
                name: ASK_USER_TOOL_NAME,
                response: { output: resultOutput },
              },
            });
          } catch (err) {
            const askDuration = Date.now() - askStartMs;
            const errorMsg = err instanceof Error ? err.message : 'ask_user failed';

            auditToolCalls.push({
              tool_name: askReq.name,
              tool_id: askId,
              args: askReq.args,
              status: 'error',
              duration_ms: askDuration,
              error: errorMsg,
            });

            yield {
              type: SSEEventType.ToolCallResult,
              tool_id: askId,
              status: 'error',
              error: errorMsg,
              duration_ms: askDuration,
              timestamp: new Date().toISOString(),
            };

            toolResponseParts.push({
              functionResponse: {
                id: askId,
                name: ASK_USER_TOOL_NAME,
                response: { output: JSON.stringify({ error: errorMsg }) },
              },
            });
          }
        }
      } else if (askUserRequests.length > 0) {
        // No sessionManager — return fallback response
        for (const askReq of askUserRequests) {
          auditToolCalls.push({
            tool_name: askReq.name,
            tool_id: askReq.callId,
            args: askReq.args,
            status: 'error',
            error: 'ask_user not supported in this session mode',
          });

          toolResponseParts.push({
            functionResponse: {
              id: askReq.callId,
              name: ASK_USER_TOOL_NAME,
              response: { output: JSON.stringify({ error: 'ask_user not supported in this session mode' }) },
            },
          });
        }
      }

      // Handle other tool calls through the scheduler normally
      if (otherRequests.length > 0) {
        // --- Real-time subagent event streaming ---
        // Subscribe to SUBAGENT_ACTIVITY on the message bus so we can yield
        // subagent events as they happen (instead of waiting for dispatch to finish).
        const messageBus = config.getMessageBus();
        const subagentEventQueue: SSESubagentEvent[] = [];
        let notifyNewEvent: (() => void) | null = null;

        // Track dispatch tool call IDs for correlation
        const unmatchedDispatchCallIds = new Set<string>();
        const dispatchIdToCallId = new Map<string, string>();
        for (const req of otherRequests) {
          if (req.name === 'dispatch') {
            unmatchedDispatchCallIds.add(req.callId);
          }
        }

        const hasDispatchCalls = unmatchedDispatchCallIds.size > 0;

        const subagentListener = (msg: SubagentActivityMessage): void => {
          // Map dispatchId to the parent tool callId
          let parentToolId = dispatchIdToCallId.get(msg.dispatchId);
          if (!parentToolId && unmatchedDispatchCallIds.size > 0) {
            // Assign to the first unmatched dispatch call
            const firstUnmatched = unmatchedDispatchCallIds.values().next().value;
            if (firstUnmatched) {
              unmatchedDispatchCallIds.delete(firstUnmatched);
              dispatchIdToCallId.set(msg.dispatchId, firstUnmatched);
              parentToolId = firstUnmatched;
            }
          }
          if (!parentToolId) return;

          subagentEventQueue.push(subagentMessageToSSE(msg, parentToolId));
          // Wake up the yield loop
          notifyNewEvent?.();
          notifyNewEvent = null;
        };

        if (hasDispatchCalls) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any -- custom event not in upstream Message union; EventEmitter accepts any string
          (messageBus as any).subscribe(SUBAGENT_ACTIVITY_EVENT, subagentListener);
        }

        // Start the scheduler (don't await yet — we'll yield events concurrently)
        let completedToolCalls: CompletedToolCall[] | undefined;
        const schedulerPromise = scheduler.schedule(otherRequests, signal).then((result) => {
          completedToolCalls = result;
          // Wake up the yield loop so it can exit
          notifyNewEvent?.();
          notifyNewEvent = null;
        });

        // Yield subagent events in real-time while the scheduler is running
        if (hasDispatchCalls) {
          while (completedToolCalls === undefined || subagentEventQueue.length > 0) {
            // Drain any pending events
            while (subagentEventQueue.length > 0) {
              yield subagentEventQueue.shift()!;
            }
            // If scheduler isn't done, wait for a new event or completion
            if (completedToolCalls === undefined) {
              await new Promise<void>((resolve) => {
                notifyNewEvent = resolve;
                // Also resolve if the scheduler finishes while we're waiting
                schedulerPromise.then(() => {
                  resolve();
                  return;
                }, () => {
                  resolve();
                  return;
                });
              });
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any -- custom event not in upstream Message union; EventEmitter accepts any string
          (messageBus as any).unsubscribe(SUBAGENT_ACTIVITY_EVENT, subagentListener);
        }

        // Ensure scheduler has completed (no-op if already resolved)
        await schedulerPromise;

        // Process completed tool calls
        for (const completed of completedToolCalls!) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- accessing optional field on CompletedToolCall union
          const duration = 'durationMs' in completed ? (completed as unknown as Record<string, number>)['durationMs'] : undefined;

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- inner_tool_calls from subagent data
          const innerCalls = completed.response.data?.['inner_tool_calls'] as Array<Record<string, unknown>> | undefined;

          // Accumulate tool call summary for audit
          auditToolCalls.push({
            tool_name: completed.request.name,
            tool_id: completed.request.callId,
            args: completed.request.args,
            status: completed.response.error ? 'error' : 'success',
            duration_ms: duration,
            error: completed.response.error?.message,
            result: extractResultText(completed.response.responseParts),
            inner_tool_calls: innerCalls,
          });

          // Most subagent events were streamed in real-time above.
          // The COMPLETE event (agent's final summary) may be missed due to race
          // conditions, so emit it from the batch data as a fallback.
          if (completed.request.name === 'dispatch' && completed.response.data) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- subagent_events from dispatch tool data
            const batchEvents = completed.response.data['subagent_events'] as
              Array<{ agentName: string; type: string; data: Record<string, unknown> }> | undefined;
            if (batchEvents) {
              for (const evt of batchEvents) {
                if (evt.type === 'COMPLETE' && typeof evt.data['text'] === 'string') {
                  yield {
                    type: SSEEventType.SubagentEvent,
                    parent_tool_id: completed.request.callId,
                    agent_name: evt.agentName,
                    event_type: 'complete',
                    text: evt.data['text'],
                    timestamp: new Date().toISOString(),
                  };
                }
              }
            }
          }

          if (completed.request.name === PRESENT_TOOL_NAME && !completed.response.error) {
            // Emit a widget event instead of tool_call_result for the present tool
            const args = completed.request.args;
            const widgetType = String(args['widget'] ?? 'unknown');
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- LLM-provided data object
            const widgetData = (args['data'] as Record<string, unknown>) ?? {};
            widgetEvents.push({ widgetType, data: widgetData });
            contentBlockOrder.push({ type: 'widget', widgetType, data: widgetData });
            yield {
              type: SSEEventType.Widget,
              widget_type: widgetType,
              data: widgetData,
              timestamp: new Date().toISOString(),
            };
          } else {
            trackToolCall(completed.request.callId);
            yield {
              type: SSEEventType.ToolCallResult,
              tool_id: completed.request.callId,
              status: completed.response.error ? 'error' : 'success',
              result: extractResultText(completed.response.responseParts)?.slice(0, 500),
              duration_ms: duration,
              error: completed.response.error?.message,
              timestamp: new Date().toISOString(),
            };
          }

          // Track skill activations
          if (
            completed.request.name === ACTIVATE_SKILL_TOOL_NAME &&
            !completed.response.error
          ) {
            const skillName = String(completed.request.args['name'] ?? '');
            if (skillName) {
              skillsActivated.push(skillName);
              yield {
                type: SSEEventType.SkillActivated,
                skill_name: skillName,
                timestamp: new Date().toISOString(),
              };
            }
          }

          if (completed.response.responseParts) {
            toolResponseParts.push(...completed.response.responseParts);
          }
        }

        // Record tool calls
        try {
          const currentModel =
            geminiClient.getCurrentSequenceModel() ?? config.getModel();
          geminiClient
            .getChat()
            .recordCompletedToolCalls(currentModel, completedToolCalls!);
        } catch {
          // Non-critical
        }

        const stopTool = completedToolCalls!.find(
          (tc) => tc.response.errorType === ToolErrorType.STOP_EXECUTION,
        );
        if (stopTool) {
          logSessionCompleted(audit, session.id, message, responseText, turnCount, auditToolCalls, skillsActivated, auditStatus, auditError, sessionStartMs, geminiClient.getCurrentSequenceModel() ?? config.getModel(), tokens);
          accumulateAssistantAndSave(session, audit, responseText, auditToolCalls, skillsActivated, widgetEvents, contentBlockOrder, 'completed');
          yield {
            type: SSEEventType.Done,
            timestamp: new Date().toISOString(),
          };
          return;
        }
      }

      currentMessages = [{ role: 'user', parts: toolResponseParts }];
    } else {
      break;
    }
  }

  logSessionCompleted(audit, session.id, message, responseText, turnCount, auditToolCalls, skillsActivated, auditStatus, auditError, sessionStartMs, geminiClient.getCurrentSequenceModel() ?? config.getModel(), tokens);
  accumulateAssistantAndSave(session, audit, responseText, auditToolCalls, skillsActivated, widgetEvents, contentBlockOrder, auditStatus === 'completed' ? 'completed' : 'error');

  yield {
    type: SSEEventType.Done,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Accumulate the assistant response message and fire-and-forget save to platform-api.
 */
function accumulateAssistantAndSave(
  session: ManagedSession,
  audit: StreamAuditContext | undefined,
  responseText: string,
  toolCalls: ToolCallSummary[],
  skillsActivated: string[],
  widgetEvents: Array<{ widgetType: string; data: Record<string, unknown> }>,
  contentBlocks: Array<Record<string, unknown>>,
  status: 'active' | 'completed' | 'error',
): void {
  const assistantMsg: SessionMessage = {
    type: 'assistant_text',
    id: `msg-${Date.now()}`,
    text: responseText,
    timestamp: new Date().toISOString(),
    toolCalls: toolCalls.map((tc) => ({
      toolName: tc.tool_name,
      toolId: tc.tool_id,
      args: tc.args,
      status: tc.status,
      duration_ms: tc.duration_ms,
      error: tc.error,
      result: tc.result,
      inner_tool_calls: tc.inner_tool_calls,
    })),
    skillActivations: skillsActivated,
    widgets: widgetEvents.map((w) => ({
      widgetType: w.widgetType,
      data: w.data,
    })),
    contentBlocks,
  };
  session.accumulatedMessages.push(assistantMsg);

  if (audit) {
    saveSessionHistory(audit, session.id, session.accumulatedMessages, status, {
      model: session.model,
      provider: session.provider,
    });
  }
}

function logSessionCompleted(
  audit: StreamAuditContext | undefined,
  sessionId: string,
  message: string,
  response: string,
  turns: number,
  toolCalls: ToolCallSummary[],
  skillsActivated: string[],
  status: 'completed' | 'error' | 'max_turns',
  error: string | undefined,
  startMs: number,
  model?: string,
  tokens?: TokenCounts,
): void {
  if (!audit) return;
  const details: Record<string, unknown> = {
    message,
    response,
    app_id: audit.appId,
    org_id: audit.orgId,
    turns,
    duration_ms: Date.now() - startMs,
    status,
    tool_calls: toolCalls,
    skills_activated: skillsActivated,
  };
  if (error) {
    details['error'] = error;
  }
  audit.auditClient.log(audit.appId, audit.token, {
    event: 'session_completed',
    resource_name: sessionId,
    details,
  });

  // Report usage to platform API
  const taskAgentRuns = toolCalls.filter((tc) => tc.tool_name === 'dispatch').length;
  reportUsage(audit, model ?? 'unknown', taskAgentRuns, tokens ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
}
