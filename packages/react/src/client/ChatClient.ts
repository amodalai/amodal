/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { TypedEventEmitter } from './EventEmitter';
import { ChatStream } from './ChatStream';
import type { ChatResponse } from './ChatStream';
import { createSession, streamChat } from './chat-api';
import type { ChatUser, ChatMessage, AssistantTextMessage, ToolCallInfo, KBProposalInfo } from '../types';
import { WidgetEventBus } from '../events/event-bus';
import type { WidgetEvent, EntityExtractor, ToolExecutedEvent, SkillActivatedEvent, WidgetRenderedEvent, KBProposalEvent } from '../events/types';

/**
 * Configuration for the ChatClient.
 */
export interface ChatClientConfig {
  serverUrl: string;
  user: ChatUser;
  /** Bearer token (API key or JWT) for authenticated requests. */
  token?: string;
  /** Custom entity extractors. If provided, replaces the default extractor. */
  entityExtractors?: EntityExtractor[];
}

/**
 * Events emitted by the ChatClient.
 */
export interface ClientEvents {
  connected: undefined;
  disconnected: undefined;
  reconnecting: number;
  message: ChatMessage;
  streaming_start: undefined;
  streaming_end: undefined;
  error: Error;
  tool_executed: ToolExecutedEvent;
  skill_activated: SkillActivatedEvent;
  widget_rendered: WidgetRenderedEvent;
  kb_proposal_received: KBProposalEvent;
  entity_referenced: WidgetEvent;
}

let msgCounter = 0;
function makeId(): string {
  msgCounter++;
  return `msg-${Date.now()}-${String(msgCounter)}`;
}

/**
 * Headless chat client for framework-agnostic integrations.
 * Manages session lifecycle, message history, and SSE streaming.
 */
export class ChatClient extends TypedEventEmitter<ClientEvents> {
  private config: ChatClientConfig;
  private sessionId: string | null = null;
  private _messages: ChatMessage[] = [];
  private _isConnected = false;
  private _isStreaming = false;
  private connectAttempt = 0;
  private maxReconnectAttempts = 3;
  private _eventBus: WidgetEventBus;

  constructor(config: ChatClientConfig) {
    super();
    this.config = config;
    this._eventBus = new WidgetEventBus();
    if (config.entityExtractors) {
      this._eventBus.setExtractors(config.entityExtractors);
    }
    // Forward entity_referenced events from bus to client events
    this._eventBus.on('entity_referenced', (e) => {
      this.emit('entity_referenced', e);
    });
  }

  /** The widget event bus. Subscribe to agent-driven events here. */
  get events(): WidgetEventBus {
    return this._eventBus;
  }

  /** Whether the client has an active session. */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /** Whether a response is currently streaming. */
  get isStreaming(): boolean {
    return this._isStreaming;
  }

  /** Current session ID, or null if not connected. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Readonly message history. */
  get messages(): readonly ChatMessage[] {
    return this._messages;
  }

  /** Establish a session with the server. */
  async connect(): Promise<void> {
    try {
      const session = await createSession(
        this.config.serverUrl,
        this.config.user,
        this.config.token,
      );
      this.sessionId = session.session_id;
      this._isConnected = true;
      this.connectAttempt = 0;
      this.emit('connected', undefined);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      throw error;
    }
  }

  /** Disconnect and clean up. */
  async disconnect(): Promise<void> {
    this.sessionId = null;
    this._isConnected = false;
    this._isStreaming = false;
    this.emit('disconnected', undefined);
  }

  /** Clear message history. */
  clearHistory(): void {
    this._messages = [];
  }

  /**
   * Send a message and wait for the full response.
   * Auto-connects if not already connected.
   */
  async send(text: string): Promise<ChatResponse> {
    if (!this._isConnected) {
      await this.connect();
    }

    // Add user message
    const userMsg: ChatMessage = {
      type: 'user',
      id: makeId(),
      text,
      timestamp: new Date().toISOString(),
    };
    this._messages.push(userMsg);
    this.emit('message', userMsg);

    // Create assistant message placeholder
    const assistantMsg: AssistantTextMessage = {
      type: 'assistant_text',
      id: makeId(),
      text: '',
      toolCalls: [],
      confirmations: [],
      skillActivations: [],
      kbProposals: [],
      widgets: [],
      contentBlocks: [],
      timestamp: new Date().toISOString(),
    };
    this._messages.push(assistantMsg);
    this.emit('message', assistantMsg);

    this._isStreaming = true;
    this.emit('streaming_start', undefined);

    try {
      const response = await this.streamInternal(text, assistantMsg);
      return response;
    } catch (err) {
      // Try reconnection
      if (this.connectAttempt < this.maxReconnectAttempts) {
        return await this.reconnectAndRetry(text, assistantMsg);
      }
      throw err;
    } finally {
      this._isStreaming = false;
      this.emit('streaming_end', undefined);
    }
  }

  /**
   * Stream a message, returning a ChatStream handle for event-based consumption.
   */
  stream(text: string): ChatStream {
    // Add user message
    const userMsg: ChatMessage = {
      type: 'user',
      id: makeId(),
      text,
      timestamp: new Date().toISOString(),
    };
    this._messages.push(userMsg);
    this.emit('message', userMsg);

    this._isStreaming = true;
    this.emit('streaming_start', undefined);

    const chatStream = new ChatStream(this.config.serverUrl, {
      message: text,
      session_id: this.sessionId ?? undefined,
      role: this.config.user.role,
    }, this.config.token);

    // Track streaming state
    chatStream.on('done', (response) => {
      // Add assistant message to history
      const assistantMsg: AssistantTextMessage = {
        type: 'assistant_text',
        id: makeId(),
        text: response.text,
        toolCalls: response.toolCalls,
        confirmations: [],
        skillActivations: response.skillsUsed,
        kbProposals: response.kbProposals,
        widgets: [],
        contentBlocks: [],
        timestamp: new Date().toISOString(),
      };
      this._messages.push(assistantMsg);
      this.emit('message', assistantMsg);
      this._isStreaming = false;
      this.emit('streaming_end', undefined);
    });

    chatStream.on('error', (err) => {
      this._isStreaming = false;
      this.emit('streaming_end', undefined);
      this.emit('error', new Error(err.message));
    });

    return chatStream;
  }

  private async streamInternal(
    text: string,
    assistantMsg: AssistantTextMessage,
  ): Promise<ChatResponse> {
    const response: ChatResponse = {
      text: '',
      toolCalls: [],
      skillsUsed: [],
      kbProposals: [],
    };

    const pendingToolCalls = new Map<string, { toolName: string; parameters: Record<string, unknown> }>();

    const stream = streamChat(
      this.config.serverUrl,
      {
        message: text,
        session_id: this.sessionId ?? undefined,
        role: this.config.user.role,
      },
      undefined,
      this.config.token,
    );

    for await (const event of stream) {
      switch (event.type) {
        case 'init':
          this.sessionId = event.session_id;
          break;
        case 'text_delta':
          response.text += event.content;
          assistantMsg.text += event.content;
          break;
        case 'tool_call_start': {
          const tc: ToolCallInfo = {
            toolId: event.tool_id,
            toolName: event.tool_name,
            parameters: event.parameters,
            status: 'running',
          };
          response.toolCalls.push(tc);
          assistantMsg.toolCalls = [...assistantMsg.toolCalls, tc];
          pendingToolCalls.set(event.tool_id, {
            toolName: event.tool_name,
            parameters: event.parameters,
          });
          break;
        }
        case 'tool_call_result': {
          const existing = response.toolCalls.find((t) => t.toolId === event.tool_id);
          if (existing) {
            existing.status = event.status;
            existing.result = event.result;
            existing.duration_ms = event.duration_ms;
            existing.error = event.error;
          }
          assistantMsg.toolCalls = assistantMsg.toolCalls.map((t) =>
            t.toolId === event.tool_id
              ? { ...t, status: event.status, result: event.result, duration_ms: event.duration_ms, error: event.error }
              : t,
          );

          const pending = pendingToolCalls.get(event.tool_id);
          pendingToolCalls.delete(event.tool_id);
          const toolEvent: ToolExecutedEvent = {
            type: 'tool_executed',
            toolName: pending?.toolName ?? '',
            toolId: event.tool_id,
            parameters: pending?.parameters ?? {},
            status: event.status,
            result: event.result,
            duration_ms: event.duration_ms,
            error: event.error,
            timestamp: event.timestamp,
          };
          this._eventBus.processEvent(toolEvent);
          this.emit('tool_executed', toolEvent);
          break;
        }
        case 'skill_activated': {
          response.skillsUsed.push(event.skill);
          assistantMsg.skillActivations = [...assistantMsg.skillActivations, event.skill];
          const skillEvent: SkillActivatedEvent = {
            type: 'skill_activated',
            skill: event.skill,
            timestamp: event.timestamp,
          };
          this._eventBus.processEvent(skillEvent);
          this.emit('skill_activated', skillEvent);
          break;
        }
        case 'kb_proposal': {
          const proposal: KBProposalInfo = {
            scope: event.scope,
            title: event.title,
            reasoning: event.reasoning,
          };
          response.kbProposals.push(proposal);
          assistantMsg.kbProposals = [...assistantMsg.kbProposals, proposal];
          const kbEvent: KBProposalEvent = {
            type: 'kb_proposal',
            proposal,
            timestamp: event.timestamp,
          };
          this._eventBus.processEvent(kbEvent);
          this.emit('kb_proposal_received', kbEvent);
          break;
        }
        case 'widget': {
          const widgetEvent: WidgetRenderedEvent = {
            type: 'widget_rendered',
            widgetType: event.widget_type,
            data: event.data,
            timestamp: event.timestamp,
          };
          this._eventBus.processEvent(widgetEvent);
          this.emit('widget_rendered', widgetEvent);
          break;
        }
        case 'error':
          throw new Error(event.message);
        case 'done':
          break;
        default:
          break;
      }
    }

    return response;
  }

  private async reconnectAndRetry(
    text: string,
    assistantMsg: AssistantTextMessage,
  ): Promise<ChatResponse> {
    this.connectAttempt++;
    this.emit('reconnecting', this.connectAttempt);

    // Exponential backoff: 100ms, 200ms, 400ms
    const delay = 100 * Math.pow(2, this.connectAttempt - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
      return await this.streamInternal(text, assistantMsg);
    } catch (err) {
      if (this.connectAttempt < this.maxReconnectAttempts) {
        return this.reconnectAndRetry(text, assistantMsg);
      }
      throw err;
    }
  }
}
