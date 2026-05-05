/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session Manager — session creation, persistence, resume, and cleanup.
 *
 * Wires together:
 * - Agent loop for message execution
 * - Context compiler for system prompt building
 * - Tool registry for tool management
 * - Postgres session store for persistence
 */

import {randomUUID} from 'node:crypto';
import type {ModelMessage} from 'ai';
import {runAgent} from '../agent/loop.js';
import {DEFAULT_LOOP_CONFIG} from '../agent/loop-types.js';
import type {AgentContext, AgentLoopConfig} from '../agent/loop-types.js';
import {matchIntent, runIntent} from '../intent/index.js';
import {SSEEventType} from '../types.js';
import type {SSEEvent} from '../types.js';
import type {ToolContext} from '../tools/types.js';
import type {SessionStore} from './store.js';
import type {
  Session,
  SessionManagerOptions,
  CreateSessionOptions,
  PersistedSession,
  TurnUsage,
  AutomationResult,
} from './types.js';
import {SessionError} from '../errors.js';
import {VISION_PROVIDERS} from '../providers/types.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

/**
 * Manages the full session lifecycle: create, execute messages, persist,
 * resume, and cleanup.
 */
export class StandaloneSessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingResumes = new Map<string, Promise<Session | null>>();
  readonly store: SessionStore | null;
  private readonly logger: Logger;
  private readonly ttlMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly defaultMaxTurns: number;
  private readonly defaultMaxContextTokens: number;
  private readonly defaultMaxSessionTokens: number | undefined;
  private readonly eventBus: SessionManagerOptions['eventBus'];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SessionManagerOptions & {store?: SessionStore}) {
    this.store = opts.store ?? null;
    this.logger = opts.logger;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.cleanupIntervalMs = opts.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.defaultMaxTurns = opts.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
    this.defaultMaxContextTokens = opts.defaultMaxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    this.defaultMaxSessionTokens = opts.defaultMaxSessionTokens;
    this.eventBus = opts.eventBus;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the cleanup timer. Call once at startup.
   */
  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, this.cleanupIntervalMs);

    this.logger.debug('session_manager_started', {
      ttlMs: this.ttlMs,
      cleanupIntervalMs: this.cleanupIntervalMs,
    });
  }

  /**
   * Gracefully shut down: destroy all sessions and stop cleanup.
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Copy keys to avoid modifying map during iteration
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.destroy(id);
    }

    if (this.store) {
      await this.store.close();
    }

    this.logger.info('session_manager_shutdown', {sessionsDestroyed: ids.length});
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Create a new session.
   *
   * The caller is responsible for building the provider, tool registry,
   * permission checker, and system prompt (via the context compiler).
   * This keeps the session manager focused on lifecycle, not orchestration.
   */
  create(opts: CreateSessionOptions): Session {
    const id = randomUUID();
    const now = Date.now();

    const appId = opts.appId ?? 'local';
    const scopeId = opts.scopeId ?? '';
    // Persist appId into metadata so SessionStore.list() can filter by it
    // (e.g. exclude eval-runner / admin sessions from the chat history UI).
    const metadata = {...(opts.metadata ?? {}), appId, model: opts.provider.model, provider: opts.provider.provider};

    // Create a child logger with scopeId so all downstream log events for this
    // session automatically include scope_id for correlation and filtering.
    const sessionLogger = scopeId
      ? this.logger.child({scopeId})
      : this.logger;

    const session: Session = {
      id,
      provider: opts.provider,
      toolRegistry: opts.toolRegistry,
      permissionChecker: opts.permissionChecker,
      logger: sessionLogger,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages ?? [],
      usage: opts.usage ?? {inputTokens: 0, outputTokens: 0, totalTokens: 0},
      model: opts.provider.model,
      providerName: opts.provider.provider,
      appId,
      scopeId,
      metadata,
      createdAt: now,
      lastAccessedAt: now,
      maxTurns: opts.maxTurns ?? this.defaultMaxTurns,
      maxContextTokens: opts.maxContextTokens ?? this.defaultMaxContextTokens,
      maxSessionTokens: opts.maxSessionTokens ?? this.defaultMaxSessionTokens,
      toolContextFactory: opts.toolContextFactory,
      intents: opts.intents ?? [],
    };

    this.sessions.set(id, session);

    this.logger.info('session_created', {
      session: id,
      model: session.model,
      provider: session.providerName,
      appId: session.appId,
      scopeId: session.scopeId,
      toolCount: opts.toolRegistry.size,
    });

    this.eventBus?.emit({
      type: 'session_created',
      sessionId: id,
      appId: session.appId,
    });

    return session;
  }

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------

  /**
   * Run a message through the agent loop and yield SSE events.
   *
   * This is the main execution path. The caller iterates over the
   * generator and sends events to the client (HTTP SSE, WebSocket, etc.).
   */
  async *runMessage(
    sessionId: string,
    userMessage: string,
    opts?: {
      images?: Array<{mimeType: string; data: string}>;
      signal?: AbortSignal;
      loopConfig?: Partial<AgentLoopConfig>;
      onUsage?: (usage: TurnUsage) => void;
      onAutomationResult?: (result: AutomationResult) => void;
      waitForConfirmation?: (callId: string) => Promise<boolean>;
      buildToolContext?: (callId: string) => ToolContext;
      summarizeToolResult?: AgentContext['summarizeToolResult'];
    },
  ): AsyncGenerator<SSEEvent> {
    const session = this.getOrThrow(sessionId);
    session.lastAccessedAt = Date.now();

    // Append user message (with optional image attachments)
    const images = opts?.images ?? [];
    const supportsVision = VISION_PROVIDERS.has(session.providerName);

    const userMsg: ModelMessage = images.length > 0 && supportsVision
      ? {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              image: img.data,
              mediaType: img.mimeType,
            })),
            {type: 'text' as const, text: userMessage},
          ],
        }
      : {role: 'user', content: userMessage};
    session.messages = [...session.messages, userMsg];

    // Warn the user if images were stripped
    if (images.length > 0 && !supportsVision) {
      yield {
        type: SSEEventType.Warning,
        message: `Images are not supported by ${session.providerName} — your image was not sent to the model.`,
        timestamp: new Date().toISOString(),
      } satisfies SSEEvent;
    }

    // Intent routing — deterministic shortcut layer in front of the
    // agent loop. Tested only when the user message is plain text;
    // multimodal turns (image-bearing) always go to the LLM since
    // intent regexes are textual. First-match-wins; on a clean
    // completion we skip the agent loop entirely. On fall-through
    // (handler returned null before any tool ran) we proceed to the
    // LLM as if no intent existed.
    if (session.intents.length > 0 && images.length === 0) {
      const matched = matchIntent(session.intents, userMessage);
      if (matched) {
        // Single-line route marker — easy to grep + visible in dev
        // (passesQuietFilter passes `intent_` lines through). Pairs
        // with the route_llm log below so each turn reports exactly
        // one route decision.
        session.logger.info('route_intent', {
          sessionId: session.id,
          intentId: matched.intent.id,
          userMessagePreview: userMessage.slice(0, 80),
        });
        const buildToolContext =
          opts?.buildToolContext ?? makeNoOpToolContext(session);
        const intentGen = runIntent({
          match: matched,
          userMessage,
          sessionId: session.id,
          scopeId: session.scopeId,
          toolRegistry: session.toolRegistry,
          buildToolContext,
          logger: session.logger,
        });
        let next = await intentGen.next();
        while (!next.done) {
          yield next.value;
          next = await intentGen.next();
        }
        const outcome = next.value;
        if (outcome.kind === 'completed') {
          session.messages = [
            ...session.messages,
            outcome.assistantMessage,
            ...outcome.toolMessages,
          ];
          if (this.store) {
            await this.persist(session);
          }
          return;
        }
        if (outcome.kind === 'completedContinue') {
          // Intent did its deterministic part — validate, persist,
          // whatever — then handed off to the LLM for the next-step
          // rendering (multi-option ask_choice, conversational
          // framing, optional-batch copy). Append the synthetic
          // messages so the LLM sees the new state, then fall
          // through to the agent loop. The agent loop emits its own
          // Done event when the LLM turn finishes; runIntent
          // suppresses the intent-side Done so we don't double-fire.
          session.messages = [
            ...session.messages,
            outcome.assistantMessage,
            ...outcome.toolMessages,
          ];
          if (this.store) {
            await this.persist(session);
          }
          session.logger.info('route_llm', {
            sessionId: session.id,
            reason: 'intent_continued',
            intentId: matched.intent.id,
          });
          // Fall through to agent loop below.
        } else if (outcome.kind === 'errored') {
          // Intent emitted an error SSE; the user has the failure
          // visible. Don't fall through — they retry or type
          // something more general (which won't match any intent
          // and will hit the LLM next turn).
          if (this.store) {
            await this.persist(session);
          }
          return;
        } else {
          // outcome.kind === 'fellThrough' — fall through to the LLM.
          // No SSE events emitted, no messages appended; the agent
          // loop runs as if intent routing never happened. Log the
          // route flip so the dev terminal shows why the LLM ran.
          session.logger.info('route_llm', {
            sessionId: session.id,
            reason: 'intent_fell_through',
            intentId: matched.intent.id,
          });
        }
      } else {
        session.logger.info('route_llm', {
          sessionId: session.id,
          reason: 'no_intent_match',
          userMessagePreview: userMessage.slice(0, 80),
        });
      }
    } else if (session.intents.length === 0) {
      session.logger.info('route_llm', {
        sessionId: session.id,
        reason: 'no_intents_loaded',
      });
    } else if (images.length > 0) {
      session.logger.info('route_llm', {
        sessionId: session.id,
        reason: 'multimodal_skips_intent',
      });
    }

    // Build AgentContext from Session
    const ctx: AgentContext = {
      provider: session.provider,
      toolRegistry: session.toolRegistry,
      permissionChecker: session.permissionChecker,
      logger: session.logger,
      signal: opts?.signal ?? AbortSignal.timeout(600_000),
      sessionId: session.id,
      systemPrompt: session.systemPrompt,
      messages: session.messages,
      usage: session.usage,
      turnCount: 0,
      maxTurns: session.maxTurns,
      maxContextTokens: session.maxContextTokens,
      maxSessionTokens: session.maxSessionTokens,
      config: {...DEFAULT_LOOP_CONFIG, ...opts?.loopConfig},
      compactionFailures: 0,
      preExecutionCache: new Map(),
      confirmedCallIds: new Set(),
      disabledToolsUntilTurn: new Map(),
      waitForConfirmation: opts?.waitForConfirmation ?? (() => Promise.resolve(true)),
      buildToolContext: opts?.buildToolContext ?? makeNoOpToolContext(session),
      onUsage: opts?.onUsage,
      summarizeToolResult: opts?.summarizeToolResult,
    };

    // Run the agent loop.
    // RunAgentOptions.messages seeds the initial ThinkingState. ctx.messages is the
    // same reference and gets mutated by the loop (appending assistant/tool messages).
    // After the loop, we sync ctx.messages back to session.messages.
    for await (const event of runAgent({messages: session.messages, context: ctx})) {
      yield event;
    }

    // Sync mutable state back to session
    session.messages = ctx.messages;
    session.usage = ctx.usage;

    // Persist if store is available. The store layer automatically extracts
    // inline image data into a separate column to avoid JSONB bloat, and
    // rehydrates them on session load.
    if (this.store) {
      await this.persist(session);
    }
  }

  // -------------------------------------------------------------------------
  // Persist / Resume
  // -------------------------------------------------------------------------

  /**
   * Persist a session to the backing store.
   */
  async persist(session: Session): Promise<void> {
    if (!this.store) return;

    // Bump lastAccessedAt in lockstep with updatedAt. Keeping them
    // synchronized means the in-memory session's "most recent activity"
    // timestamp and the DB's `updated_at` column (which drives
    // list-ordering) can't drift — the list order users see always
    // matches what the live session would say.
    const now = Date.now();
    session.lastAccessedAt = now;

    const persisted: PersistedSession = {
      version: 1,
      id: session.id,
      scopeId: session.scopeId,
      messages: session.messages,
      tokenUsage: session.usage,
      metadata: session.metadata,
      imageData: {},
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(now),
    };

    await this.store.save(persisted);

    this.eventBus?.emit({
      type: 'session_updated',
      sessionId: session.id,
      appId: session.appId,
      title: session.metadata.title,
    });
  }

  /**
   * Resume a session from the backing store.
   *
   * Loads persisted messages and token usage, then creates a new live
   * session with a fresh provider/registry/prompt. The system prompt is
   * recompiled (not stale) — the caller provides the current prompt.
   *
   * Concurrent resume calls for the same session ID are deduplicated —
   * only one store fetch runs, and all callers share the result.
   */
  async resume(
    sessionId: string,
    opts: CreateSessionOptions,
  ): Promise<Session | null> {
    const pending = this.pendingResumes.get(sessionId);
    if (pending) {
      this.logger.debug('session_resume_dedup', {
        session: sessionId,
        message: 'Concurrent resume request deduplicated — second caller receives first caller\'s session. CreateSessionOptions from second call are ignored.',
      });
      return pending;
    }

    const promise = this.doResume(sessionId, opts);
    this.pendingResumes.set(sessionId, promise);

    try {
      return await promise;
    } finally {
      this.pendingResumes.delete(sessionId);
    }
  }

  private async doResume(
    sessionId: string,
    opts: CreateSessionOptions,
  ): Promise<Session | null> {
    if (!this.store) {
      throw new SessionError('Cannot resume without a session store', {
        sessionId,
        context: {operation: 'resume'},
      });
    }

    const persisted = await this.store.load(sessionId);
    if (!persisted) return null;

    // Create a fresh session seeded with persisted state
    const session = this.create({
      ...opts,
      messages: persisted.messages,
      usage: persisted.tokenUsage,
      metadata: {...persisted.metadata, ...opts.metadata},
    });

    // Replace generated ID with the original
    this.sessions.delete(session.id);
    session.id = sessionId;
    this.sessions.set(sessionId, session);

    this.logger.info('session_resumed', {
      session: sessionId,
      messageCount: persisted.messages.length,
      version: persisted.version,
    });

    return session;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /** Get a session by ID. Returns undefined if not found. */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Check if a session exists in memory. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** List persisted sessions from the backing store, newest first. */
  async listPersisted(opts?: {limit?: number}): Promise<PersistedSession[]> {
    if (!this.store) return [];
    const result = await this.store.list(opts);
    return result.sessions;
  }

  /** Number of active in-memory sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Get the backing session store (for advanced queries like findByScopeId). */
  getStore(): SessionStore | null {
    return this.store;
  }

  // -------------------------------------------------------------------------
  // Destroy / Cleanup
  // -------------------------------------------------------------------------

  /**
   * Destroy a session. Removes from memory and optionally from store.
   */
  async destroy(sessionId: string, opts?: {deleteFromStore?: boolean}): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);

    if (opts?.deleteFromStore && this.store) {
      await this.store.delete(sessionId);
    }

    this.logger.info('session_destroyed', {
      session: sessionId,
    });

    if (opts?.deleteFromStore) {
      this.eventBus?.emit({
        type: 'session_deleted',
        sessionId,
      });
    }
  }

  /**
   * Clean up expired sessions (idle > TTL).
   * Returns the number of sessions destroyed.
   */
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - this.ttlMs;
    let destroyed = 0;

    // Copy keys to avoid modifying map during iteration
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session && session.lastAccessedAt < cutoff) {
        await this.destroy(id);
        destroyed++;
      }
    }

    if (destroyed > 0) {
      this.logger.info('session_cleanup', {destroyed});
    }

    return destroyed;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private getOrThrow(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(`Session "${sessionId}" not found`, {
        sessionId,
        context: {operation: 'getOrThrow', activeSessions: this.sessions.size},
      });
    }
    return session;
  }
}

// ---------------------------------------------------------------------------
// No-op ToolContext fallback — call sites override with real wiring
// ---------------------------------------------------------------------------

function makeNoOpToolContext(session: Session): (callId: string) => ToolContext {
  return (_callId: string): ToolContext => ({
    request: () => Promise.reject(new Error('request() not wired — provide buildToolContext')),
    store: () => Promise.reject(new Error('store() not wired — provide buildToolContext')),
    env: () => undefined,
    log: (message: string) => { session.logger.debug('tool_log', {session: session.id, message}); },
    signal: AbortSignal.timeout(30_000),
    sessionId: session.id,
    scopeId: '',
  });
}
