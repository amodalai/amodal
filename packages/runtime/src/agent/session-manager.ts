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
  ensureAdminAgent,
  loadAdminAgent,
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
  private inspectMcp?: McpManager;
  private inspectMcpInitialized = false;

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
  async create(appId: string, appToken?: string): Promise<AgentSession> {
    let userRoles: string[] = [];

    // Fetch user context if configured
    if (this.repo.config.userContext && appToken) {
      try {
        const connectionsMap = this.getConnectionsMap();
        const userData = await fetchUserContext(this.repo, appToken, connectionsMap);
        userRoles = extractRoles(userData);
      } catch {
        // Degraded but functional — empty roles
      }
    }

    const runtime = setupSession({
      repo: this.repo,
      userId: appId,
      userRoles,
      isDelegated: false,
      telemetrySink: this.telemetrySink,
    });

    const planModeManager = new PlanModeManager();
    const exploreConfig = prepareExploreConfig(runtime);

    const session: AgentSession = {
      id: randomUUID(),
      runtime,
      appId,
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
   * Create an admin session for the config chat.
   * Uses admin agent skills/knowledge but the user's connections.
   */
  async createAdminSession(): Promise<AgentSession> {
    // Resolve and load admin agent
    const agentDir = await ensureAdminAgent(this.repo.origin);
    const adminContent = await loadAdminAgent(agentDir);

    // Build a modified repo: admin skills/knowledge + user connections
    const adminRepo: AmodalRepo = {
      ...this.repo,
      skills: adminContent.skills,
      knowledge: adminContent.knowledge,
      agents: {
        main: adminContent.agentPrompt ?? undefined,
        simple: undefined,
        subagents: [],
      },
      // Keep user connections so admin can validate/test them
      // Keep stores so admin can see store definitions
      // Clear automations — admin doesn't need them
      automations: [],
    };

    const runtime = setupSession({
      repo: adminRepo,
      userId: 'admin',
      userRoles: ['admin'],
      isDelegated: false,
      telemetrySink: this.telemetrySink,
    });

    const planModeManager = new PlanModeManager();
    const exploreConfig = prepareExploreConfig(runtime);

    const session: AgentSession = {
      id: randomUUID(),
      runtime,
      appId: 'admin',
      conversationHistory: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      planModeManager,
      exploreConfig,
      shellExecutor: this.shellExecutor,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Create a session from a specific repo (e.g., enriched with tenant credentials).
   * Used by hosted runtime when tenant-specific config is fetched from the platform API.
   */
  async createFromRepo(repo: AmodalRepo, appId: string): Promise<AgentSession> {
    const runtime = setupSession({
      repo,
      userId: appId,
      userRoles: [],
      isDelegated: false,
      telemetrySink: this.telemetrySink,
    });

    const planModeManager = new PlanModeManager();
    const exploreConfig = prepareExploreConfig(runtime);

    const session: AgentSession = {
      id: randomUUID(),
      runtime,
      appId,
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
    // Shutdown the persistent inspect MCP manager
    if (this.inspectMcp) {
      await this.inspectMcp.shutdown().catch(() => {});
      this.inspectMcp = undefined;
      this.inspectMcpInitialized = false;
    }
    this.sessions.clear();
  }

  /**
   * Initialize MCP servers for a session.
   * Sources: connections with protocol=mcp, plus legacy amodal.json mcp.servers block.
   */
  private async initMcp(session: AgentSession, repo: AmodalRepo): Promise<void> {
    const mcpServers: Record<string, {transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean}> = {};

    // Build MCP configs from connections with protocol: "mcp"
    for (const [name, conn] of repo.connections) {
      if (conn.spec.protocol === 'mcp') {
        mcpServers[name] = {
          transport: conn.spec.transport ?? 'stdio',
          command: conn.spec.command,
          args: conn.spec.args,
          env: conn.spec.env,
          url: conn.spec.url,
          headers: conn.spec.headers,
          trust: conn.spec.trust,
        };
      }
    }

    // Merge legacy amodal.json mcp.servers block
    if (repo.mcpServers) {
      for (const [name, config] of Object.entries(repo.mcpServers)) {
        if (!mcpServers[name]) {
          mcpServers[name] = config;
        }
      }
    }

    if (Object.keys(mcpServers).length === 0) {
      return;
    }

    const manager = new McpManager();
    try {
      await manager.startServers(mcpServers);
      if (manager.connectedCount > 0) {
        session.mcpManager = manager;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[SESSION] MCP initialization failed: ${msg}\n`);
    }
  }

  /**
   * Get a persistent MCP manager for inspect/health operations.
   * Lazy-initialized on first call, reused across requests.
   */
  async getInspectMcpManager(): Promise<McpManager | undefined> {
    if (this.inspectMcpInitialized) return this.inspectMcp;
    this.inspectMcpInitialized = true;

    if (!this.repo.mcpServers || Object.keys(this.repo.mcpServers).length === 0) {
      return undefined;
    }

    const manager = new McpManager();
    try {
      await manager.startServers(this.repo.mcpServers);
      this.inspectMcp = manager;
      return manager;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[INSPECT] MCP initialization failed: ${msg}\n`);
      // Still return the manager so we can report error status
      this.inspectMcp = manager;
      return manager;
    }
  }

  private getConnectionsMap(): ReturnType<typeof buildConnectionsMap> {
    return buildConnectionsMap(this.repo.connections);
  }
}
