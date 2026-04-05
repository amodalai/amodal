/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Standalone Session Manager.
 *
 * Replaces gemini-cli-core's session lifecycle with our own. Manages
 * session creation, persistence, resume, and cleanup using:
 * - Agent loop (3.1) for message execution
 * - Context compiler (3.2) for system prompt building
 * - Tool registry for tool management
 * - PGLite session store for persistence
 *
 * The old `session-manager.ts` remains for the upstream code path
 * until the full migration is complete.
 */

import {randomUUID} from 'node:crypto';
import type {ModelMessage} from 'ai';
import {runAgent} from '../agent/loop.js';
import {DEFAULT_LOOP_CONFIG} from '../agent/loop-types.js';
import type {AgentContext, AgentLoopConfig} from '../agent/loop-types.js';
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
 * Standalone session manager.
 *
 * Manages the full session lifecycle: create, execute messages, persist,
 * resume, and cleanup. Does not depend on gemini-cli-core.
 */
export class StandaloneSessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingResumes = new Map<string, Promise<Session | null>>();
  private readonly store: SessionStore | null;
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

    this.logger.info('session_manager_started', {
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

    // Copy keys to avoid modifying map during iteration (G26)
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
    // Persist appId into metadata so SessionStore.list() can filter by it
    // (e.g. exclude eval-runner / admin sessions from the chat history UI).
    const metadata = {...(opts.metadata ?? {}), appId};

    const session: Session = {
      id,
      tenantId: opts.tenantId,
      userId: opts.userId,
      provider: opts.provider,
      toolRegistry: opts.toolRegistry,
      permissionChecker: opts.permissionChecker,
      logger: this.logger,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages ?? [],
      usage: opts.usage ?? {inputTokens: 0, outputTokens: 0, totalTokens: 0},
      model: opts.provider.model,
      providerName: opts.provider.provider,
      userRoles: opts.userRoles ?? [],
      appId,
      metadata,
      createdAt: now,
      lastAccessedAt: now,
      maxTurns: opts.maxTurns ?? this.defaultMaxTurns,
      maxContextTokens: opts.maxContextTokens ?? this.defaultMaxContextTokens,
      maxSessionTokens: opts.maxSessionTokens ?? this.defaultMaxSessionTokens,
      toolContextFactory: opts.toolContextFactory,
    };

    this.sessions.set(id, session);

    this.logger.info('session_created', {
      session: id,
      tenant: opts.tenantId,
      model: session.model,
      provider: session.providerName,
      appId: session.appId,
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

    // Append user message
    const userMsg: ModelMessage = {role: 'user', content: userMessage};
    session.messages = [...session.messages, userMsg];

    // Build AgentContext from Session
    const ctx: AgentContext = {
      provider: session.provider,
      toolRegistry: session.toolRegistry,
      permissionChecker: session.permissionChecker,
      logger: session.logger,
      signal: opts?.signal ?? AbortSignal.timeout(600_000),
      sessionId: session.id,
      tenantId: session.tenantId,
      user: {roles: session.userRoles},
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

    // Persist if store is available
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

    const persisted: PersistedSession = {
      version: 1,
      id: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      messages: session.messages,
      tokenUsage: session.usage,
      metadata: session.metadata,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(),
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

    const persisted = await this.store.load(opts.tenantId, sessionId);
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
      tenant: opts.tenantId,
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

  /** List sessions for a tenant from the backing store. */
  async listPersisted(tenantId: string, opts?: {limit?: number}): Promise<PersistedSession[]> {
    if (!this.store) return [];
    const result = await this.store.list(tenantId, opts);
    return result.sessions;
  }

  /** Number of active in-memory sessions. */
  get size(): number {
    return this.sessions.size;
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
      await this.store.delete(session.tenantId, sessionId);
    }

    this.logger.info('session_destroyed', {
      session: sessionId,
      tenant: session.tenantId,
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

    // Also clean up old persisted sessions
    if (this.store) {
      const storeDeleted = await this.store.cleanup(new Date(cutoff));
      destroyed += storeDeleted;
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
// No-op ToolContext builder (replaced by real wiring at call sites)
// ---------------------------------------------------------------------------

function makeNoOpToolContext(session: Session): (callId: string) => ToolContext {
  return (_callId: string): ToolContext => ({
    request: () => Promise.reject(new Error('request() not wired — provide buildToolContext')),
    store: () => Promise.reject(new Error('store() not wired — provide buildToolContext')),
    env: () => undefined,
    log: (message: string) => { session.logger.debug('tool_log', {session: session.id, message}); },
    user: {roles: session.userRoles},
    signal: AbortSignal.timeout(30_000),
    sessionId: session.id,
    tenantId: session.tenantId,
  });
}
