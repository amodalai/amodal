/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {randomUUID} from 'node:crypto';
import type {AmodalRepo} from '@amodalai/core';
import {
  setupSession,
  PlanModeManager,
  prepareExploreConfig,
  extractRoles,
  buildConnectionsMap,
  PlatformTelemetrySink,
  McpManager,
} from '@amodalai/core';
import type {RuntimeTelemetryEvent, CustomToolExecutor, CustomShellExecutor, StoreBackend} from '@amodalai/core';
import type {AgentSession} from './agent-types.js';
import {fetchUserContext} from './user-context-fetcher.js';

export type TelemetrySink = (event: RuntimeTelemetryEvent) => void;

export interface AgentSessionManagerOptions {
  ttlMs?: number;
  telemetrySink?: TelemetrySink;
  toolExecutor?: CustomToolExecutor;
  shellExecutor?: CustomShellExecutor;
  storeBackend?: StoreBackend;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages repo-based sessions with TTL eviction.
 */
export class AgentSessionManager {
  private repo: AmodalRepo;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly ttlMs: number;
  private readonly telemetrySink?: TelemetrySink;
  private readonly toolExecutor?: CustomToolExecutor;
  private readonly shellExecutor?: CustomShellExecutor;
  private readonly storeBackend?: StoreBackend;
  private platformTelemetry?: PlatformTelemetrySink;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(repo: AmodalRepo, options?: AgentSessionManagerOptions) {
    this.repo = repo;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

    // If platform config is set and no explicit sink provided, create a platform sink
    if (!options?.telemetrySink && repo.config.platform?.apiKey) {
      const platformUrl = process.env['PLATFORM_API_URL'] ?? 'http://localhost:4000';
      this.platformTelemetry = new PlatformTelemetrySink(platformUrl, repo.config.platform.apiKey);
      this.telemetrySink = this.platformTelemetry.sink();
    } else {
      this.telemetrySink = options?.telemetrySink;
    }

    this.toolExecutor = options?.toolExecutor;
    this.shellExecutor = options?.shellExecutor;
    this.storeBackend = options?.storeBackend;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't keep the process alive
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Direct access to the repo for read-only operations (inspect, etc.) */
  getRepo(): AmodalRepo {
    return this.repo;
  }

  /**
   * Create a new session, optionally fetching user context for role extraction.
   */
  async create(tenantId: string, tenantToken?: string): Promise<AgentSession> {
    let userRoles: string[] = [];

    // Fetch user context if configured
    if (this.repo.config.userContext && tenantToken) {
      try {
        const connectionsMap = this.getConnectionsMap();
        const userData = await fetchUserContext(this.repo, tenantToken, connectionsMap);
        userRoles = extractRoles(userData);
      } catch {
        // Degraded but functional — empty roles
      }
    }

    const runtime = setupSession({
      repo: this.repo,
      userId: tenantId,
      userRoles,
      isDelegated: false,
      telemetrySink: this.telemetrySink,
    });

    const planModeManager = new PlanModeManager();
    const exploreConfig = prepareExploreConfig(runtime);

    const session: AgentSession = {
      id: randomUUID(),
      runtime,
      tenantId,
      conversationHistory: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      planModeManager,
      exploreConfig,
      toolExecutor: this.toolExecutor,
      shellExecutor: this.shellExecutor,
      storeBackend: this.storeBackend,
    };

    // Start MCP servers if configured (non-blocking)
    await this.initMcp(session, this.repo);

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Create a session from a specific repo (e.g., enriched with tenant credentials).
   * Used by hosted runtime when tenant-specific config is fetched from the platform API.
   */
  async createFromRepo(repo: AmodalRepo, tenantId: string): Promise<AgentSession> {
    const runtime = setupSession({
      repo,
      userId: tenantId,
      userRoles: [],
      isDelegated: false,
      telemetrySink: this.telemetrySink,
    });

    const planModeManager = new PlanModeManager();
    const exploreConfig = prepareExploreConfig(runtime);

    const session: AgentSession = {
      id: randomUUID(),
      runtime,
      tenantId,
      conversationHistory: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      planModeManager,
      exploreConfig,
      toolExecutor: this.toolExecutor,
      shellExecutor: this.shellExecutor,
      storeBackend: this.storeBackend,
    };

    // Start MCP servers if configured (non-blocking)
    await this.initMcp(session, repo);

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Re-register a session under a different ID (e.g., restoring original ID on hydration).
   */
  reregister(session: AgentSession, newId: string): void {
    this.sessions.delete(session.id);
    session.id = newId;
    this.sessions.set(newId, session);
  }

  /**
   * Get an existing session by ID.
   */
  get(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = Date.now();
    }
    return session;
  }

  /**
   * Destroy a session.
   */
  destroy(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Remove sessions that have been idle longer than TTL.
   * Returns the number of sessions removed.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt > this.ttlMs) {
        this.sessions.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Update the repo for all new sessions (hot reload).
   * Existing sessions keep their old repo.
   */
  updateRepo(repo: AmodalRepo): void {
    this.repo = repo;
  }

  /**
   * Shut down all sessions and stop the cleanup timer.
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.platformTelemetry) {
      await this.platformTelemetry.destroy();
      this.platformTelemetry = undefined;
    }
    // Shutdown MCP managers for all sessions
    for (const session of this.sessions.values()) {
      if (session.mcpManager) {
        await session.mcpManager.shutdown().catch(() => {});
      }
    }
    this.sessions.clear();
  }

  /**
   * Initialize MCP servers for a session if the repo has MCP config.
   */
  private async initMcp(session: AgentSession, repo: AmodalRepo): Promise<void> {
    if (!repo.mcpServers || Object.keys(repo.mcpServers).length === 0) {
      return;
    }

    const manager = new McpManager();
    try {
      await manager.startServers(repo.mcpServers);
      if (manager.connectedCount > 0) {
        session.mcpManager = manager;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[SESSION] MCP initialization failed: ${msg}\n`);
    }
  }

  private getConnectionsMap(): ReturnType<typeof buildConnectionsMap> {
    return buildConnectionsMap(this.repo.connections);
  }
}
