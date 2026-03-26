/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {
  SSEEvent,
  ToolCallInfo,
  KBProposalInfo,
  AskUserQuestion,
} from '../types';
import type { ChatStreamRequest } from '../client';
import { streamChat } from '../client';

/**
 * Full response from a completed chat stream.
 */
export interface ChatResponse {
  text: string;
  toolCalls: ToolCallInfo[];
  skillsUsed: string[];
  kbProposals: KBProposalInfo[];
}

type StreamEventHandler<T> = (data: T) => void;

/**
 * A streaming chat response handle.
 * Register `.on()` handlers then the stream starts automatically.
 */
export class ChatStream {
  private handlers: {
    text: Array<StreamEventHandler<{ text: string }>>;
    tool_call: Array<StreamEventHandler<{ tool: string; params: Record<string, unknown>; toolId: string }>>;
    tool_result: Array<StreamEventHandler<{ tool: string; data: unknown; duration_ms?: number; toolId: string }>>;
    skill_activated: Array<StreamEventHandler<{ name: string }>>;
    kb_proposal: Array<StreamEventHandler<KBProposalInfo>>;
    widget: Array<StreamEventHandler<{ widgetType: string; data: Record<string, unknown> }>>;
    ask_user: Array<StreamEventHandler<{ askId: string; questions: AskUserQuestion[] }>>;
    error: Array<StreamEventHandler<{ message: string }>>;
    done: Array<StreamEventHandler<ChatResponse>>;
  } = {
    text: [],
    tool_call: [],
    tool_result: [],
    skill_activated: [],
    kb_proposal: [],
    widget: [],
    ask_user: [],
    error: [],
    done: [],
  };

  private abortController: AbortController;
  private started = false;
  private response: ChatResponse = {
    text: '',
    toolCalls: [],
    skillsUsed: [],
    kbProposals: [],
  };
  private toolCallNames = new Map<string, string>();

  private token?: string;

  constructor(
    private serverUrl: string,
    private request: ChatStreamRequest,
    token?: string,
  ) {
    this.abortController = new AbortController();
    this.token = token;
    // Start on next microtick so .on() calls can register first
    queueMicrotask(() => this.start());
  }

  on(event: 'text', handler: StreamEventHandler<{ text: string }>): this;
  on(event: 'tool_call', handler: StreamEventHandler<{ tool: string; params: Record<string, unknown>; toolId: string }>): this;
  on(event: 'tool_result', handler: StreamEventHandler<{ tool: string; data: unknown; duration_ms?: number; toolId: string }>): this;
  on(event: 'skill_activated', handler: StreamEventHandler<{ name: string }>): this;
  on(event: 'kb_proposal', handler: StreamEventHandler<KBProposalInfo>): this;
  on(event: 'widget', handler: StreamEventHandler<{ widgetType: string; data: Record<string, unknown> }>): this;
  on(event: 'ask_user', handler: StreamEventHandler<{ askId: string; questions: AskUserQuestion[] }>): this;
  on(event: 'error', handler: StreamEventHandler<{ message: string }>): this;
  on(event: 'done', handler: StreamEventHandler<ChatResponse>): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overload implementation requires broad type
  on(event: string, handler: StreamEventHandler<any>): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- overload dispatch key narrowing
    const key = event as keyof typeof this.handlers;
    if (key in this.handlers) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- overload dispatch
      (this.handlers[key] as Array<StreamEventHandler<unknown>>).push(handler);
    }
    return this;
  }

  /** Cancel the stream. */
  abort(): void {
    this.abortController.abort();
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      const stream = streamChat(
        this.serverUrl,
        this.request,
        this.abortController.signal,
        this.token,
      );

      for await (const event of stream) {
        this.processEvent(event);
      }

      // Emit done
      for (const handler of this.handlers.done) {
        handler(this.response);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        for (const handler of this.handlers.error) {
          handler({ message });
        }
      }
    }
  }

  private processEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.response.text += event.content;
        for (const handler of this.handlers.text) {
          handler({ text: event.content });
        }
        break;
      case 'tool_call_start':
        this.toolCallNames.set(event.tool_id, event.tool_name);
        for (const handler of this.handlers.tool_call) {
          handler({ tool: event.tool_name, params: event.parameters, toolId: event.tool_id });
        }
        this.response.toolCalls.push({
          toolId: event.tool_id,
          toolName: event.tool_name,
          parameters: event.parameters,
          status: 'running',
        });
        break;
      case 'tool_call_result': {
        const toolName = this.toolCallNames.get(event.tool_id) ?? '';
        for (const handler of this.handlers.tool_result) {
          handler({ tool: toolName, data: event.result, duration_ms: event.duration_ms, toolId: event.tool_id });
        }
        // Update status in response
        const tc = this.response.toolCalls.find((t) => t.toolId === event.tool_id);
        if (tc) {
          tc.status = event.status;
          tc.result = event.result;
          tc.duration_ms = event.duration_ms;
          tc.error = event.error;
        }
        break;
      }
      case 'skill_activated':
        this.response.skillsUsed.push(event.skill);
        for (const handler of this.handlers.skill_activated) {
          handler({ name: event.skill });
        }
        break;
      case 'kb_proposal': {
        const proposal: KBProposalInfo = {
          scope: event.scope,
          title: event.title,
          reasoning: event.reasoning,
        };
        this.response.kbProposals.push(proposal);
        for (const handler of this.handlers.kb_proposal) {
          handler(proposal);
        }
        break;
      }
      case 'ask_user':
        for (const handler of this.handlers.ask_user) {
          handler({ askId: event.ask_id, questions: event.questions });
        }
        break;
      case 'error':
        for (const handler of this.handlers.error) {
          handler({ message: event.message });
        }
        break;
      case 'init':
      case 'done':
        // Init handled by ChatClient, done triggers after loop
        break;
      default: {
        // Handle widget events from extended SSE
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- checking extended SSE event type
        const extEvent = event as unknown as { type: string; widget_type?: string; data?: Record<string, unknown> };
        if (extEvent.type === 'widget' && extEvent.widget_type && extEvent.data) {
          for (const handler of this.handlers.widget) {
            handler({ widgetType: extEvent.widget_type, data: extEvent.data });
          }
        }
        break;
      }
    }
  }
}
