/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from 'node:crypto';
import {
  AmodalConfig,
  type AmodalConfigParameters,
  Scheduler,
  ROOT_SCHEDULER_ID,
  type GeminiClient,
  ApprovalMode,
  PolicyDecision,
  AgentSDK,
  buildDefaultPrompt,
} from '@amodalai/core';
import type { AuthContext } from '../middleware/auth.js';
import { convertSessionMessagesToHistory } from './history-converter.js';

export interface PendingAskUser {
  resolve: (answers: Record<string, string>) => void;
  reject: (reason: Error) => void;
}

export interface SessionMessage {
  type: 'user' | 'assistant_text' | 'error';
  id: string;
  text: string;
  timestamp: string;
  toolCalls?: Array<Record<string, unknown>>;
  skillActivations?: string[];
  widgets?: Array<Record<string, unknown>>;
  contentBlocks?: Array<Record<string, unknown>>;
}

export interface ManagedSession {
  id: string;
  config: AmodalConfig;
  geminiClient: GeminiClient;
  scheduler: Scheduler;
  createdAt: number;
  lastAccessedAt: number;
  /** The org this session belongs to */
  orgId?: string;
  /** Session type — controls which skills, tools, KB docs load */
  sessionType?: string;
  /** Pending ask_user responses awaiting user input */
  pendingAskUser: Map<string, PendingAskUser>;
  /** Accumulated messages for session history persistence */
  accumulatedMessages: SessionMessage[];
  /** Model used for this session (pinned at creation, survives hydration) */
  model?: string;
  /** Provider used for this session (pinned at creation, survives hydration) */
  provider?: string;
  /** Store backend for cleanup on session destroy */
  storeBackend?: import('@amodalai/core').StoreBackend;
}

export interface SessionManagerOptions {
  /** Base config parameters to clone for each session */
  baseParams: AmodalConfigParameters;
  /** Session TTL in milliseconds (default 30 minutes) */
  ttlMs?: number;
  /** Cleanup interval in milliseconds (default 5 minutes) */
  cleanupIntervalMs?: number;
  /** Platform API URL (for loading org-specific config per session) */
  platformApiUrl?: string;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ASK_USER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages per-request sessions: creates Config + GeminiClient + Scheduler
 * instances, tracks them by ID, and cleans up expired sessions.
 */
/** Shape returned by GET /api/tenants/:tenantId/sessions/:sessionId */
interface StoredSessionRecord {
  id: string;
  tenant_id: string;
  messages: SessionMessage[];
  status: string;
  model?: string;
  provider?: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly baseParams: AmodalConfigParameters;
  private readonly ttlMs: number;
  private readonly platformApiUrl?: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** Deduplicates concurrent hydration requests for the same conversation */
  private readonly pendingHydrations = new Map<string, Promise<ManagedSession | null>>();

  constructor(options: SessionManagerOptions) {
    this.baseParams = options.baseParams;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.platformApiUrl = options.platformApiUrl;

    const cleanupIntervalMs =
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupTimer = setInterval(
      () => void this.cleanup(),
      cleanupIntervalMs,
    );
    // Don't keep the process alive just for cleanup
    this.cleanupTimer.unref();
  }

  /**
   * Create a new session with optional role override and auth context.
   * When auth context is provided, the session is configured with
   * the caller's API key and org/app/tenant context.
   */
  async create(role?: string, auth?: AuthContext, sessionType?: string, pinnedModel?: { provider: string; model: string }, deployId?: string): Promise<ManagedSession> {
    const sessionId = randomUUID();
    const sessionParams: AmodalConfigParameters = {
      ...this.baseParams,
      sessionId,
      approvalMode: ApprovalMode.YOLO,
      interactive: false,
      noBrowser: true,
      // Disable all upstream Gemini CLI tools by default.
      // Only Amodal platform tools (request, present, etc.) are registered.
      coreTools: [],
      policyEngineConfig: {
        approvalMode: ApprovalMode.YOLO,
        defaultDecision: PolicyDecision.ALLOW,
        rules: [
          // Global ALLOW at high priority — overrides any TOML rules
          // that might require ASK_USER (which fails in non-interactive mode)
          { decision: PolicyDecision.ALLOW, priority: 9999 },
        ],
      },
    };

    if (role) {
      sessionParams.activeRole = role;
    }

    let config: AmodalConfig;

    // Platform session: use AgentSDK to fetch KB docs, org details, secrets
    if (auth?.token && this.platformApiUrl) {
      process.stderr.write(
        `[SESSION] Creating platform session: app=${auth.applicationId}, tenant=${auth.tenantId}, ` +
        `org=${auth.orgId}, key=${auth.token.slice(0, 12)}..., sessionType=${sessionType ?? '(none)'}\n`,
      );
      const sdk = new AgentSDK(
        {
          platform: {
            apiUrl: this.platformApiUrl,
            apiKey: auth.token, // JWT or ak_ key — both work as Bearer tokens
          },
          applicationId: auth.applicationId,
          tenantId: auth.tenantId,
          // base_prompt and agent_context fetched from application record during SDK initialize
          activeRole: role,
          sessionType,
          deployId,
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AmodalConfigParameters → Record for AgentSDK constructor
        sessionParams as unknown as Record<string, unknown>,
      );
      await sdk.initialize();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AgentSDK returns AmodalConfig
      config = sdk.getConfig() as unknown as AmodalConfig;
    } else {
      // Non-platform session: use Config directly
      if (auth && this.platformApiUrl) {
        sessionParams.platformApiUrl = this.platformApiUrl;
        sessionParams.applicationId = auth.applicationId;
        sessionParams.tenantId = auth.tenantId;
        if (auth.apiKey) {
          sessionParams.platformApiKey = auth.apiKey;
        }
      }

      config = new AmodalConfig(sessionParams);
      await config.initialize();
    }

    // Inject tenant secrets as process env vars so shell_exec commands can
    // reference them (e.g. $API_BASE_URL in curl commands). The shell execution
    // service inherits process.env for child processes.
    // Also add secret names to the sanitization allowlist — without this,
    // names like API_KEY get stripped by the /KEY/i pattern.
    const connections = config.getConnections();
    const connKeys = Object.keys(connections).filter((k) => k !== '_secrets');
    process.stderr.write(`[SESSION] connections: ${connKeys.join(', ') || '(none)'}\n`);
    if (sessionType === 'onboarding' && !connections['platform-api']) {
      process.stderr.write(
        `[SESSION] WARNING: onboarding session has no platform-api connection — ` +
        `the request tool cannot create resources. Check that ADMIN_APP_ID is set ` +
        `and the seed has run.\n`,
      );
    }
    // Tenant secrets are available to tools via session-scoped getSessionEnv()
    // (through ToolContext). They are NOT injected into process.env to prevent
    // cross-tenant secret leakage in multi-session runtimes.
    const secrets = connections['_secrets'];
    if (secrets && typeof secrets === 'object') {
      const secretCount = Object.keys(secrets).length;
      process.stderr.write(`[SESSION] ${secretCount} secrets available via session env\n`);
    } else {
      process.stderr.write(`[SESSION] no _secrets found in connections\n`);
    }

    // Platform tool disabling is now handled entirely via the DB-backed
    // disabled_platform_tools field on the application record. AgentSDK reads
    // this during initialize() and calls config.setDisabledTools().

    // Pinned model (from hydrated session) takes highest priority
    if (pinnedModel) {
      config.setModelConfig({
        provider: pinnedModel.provider,
        model: pinnedModel.model,
      });
    }

    // Build modelConfig from env vars if not already set by the SDK or pinned model.
    // This enables non-Gemini providers for non-platform sessions.
    // Runtime default: anthropic/claude-sonnet-4-20250514 (matches platform-api default).
    if (!config.getModelConfig()) {
      const llmProvider = process.env['LLM_PROVIDER'] ?? 'anthropic';
      if (llmProvider !== 'google') {
        config.setModelConfig({
          provider: llmProvider,
          model: process.env['MODEL'] ?? 'claude-sonnet-4-20250514',
          baseUrl: process.env['PROVIDER_BASE_URL'],
        });
      }
    }

    // Initialize store backend if stores are configured.
    // Must happen before initializeAuth/tool registration so store tools
    // are available when registerAmodalTools runs.
    const stores = config.getStores();
    let storeBackend: import('@amodalai/core').StoreBackend | undefined;
    if (stores.length > 0) {
      try {
        const { PGLiteStoreBackend } = await import('../stores/pglite-store-backend.js');
        const backend = new PGLiteStoreBackend();
        await backend.initialize(stores);
        config.setStoreBackend(backend);
        storeBackend = backend;
        process.stderr.write(`[SESSION] Initialized store backend (${String(stores.length)} store(s))\n`);
      } catch (err) {
        process.stderr.write(`[SESSION] Failed to init store backend: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    // Initialize the LLM content generator. This must always run — the
    // upstream GeminiClient requires an initialized content generator even
    // when the runtime uses non-Gemini providers (Anthropic, OpenAI).
    await config.initializeAuth();

    const geminiClient = config.getGeminiClient();

    // Override the upstream Gemini CLI system prompt with the Amodal default
    // or the user's custom basePrompt. The upstream prompt is Gemini CLI-specific
    // and not appropriate for the Amodal agent runtime.
    const systemPrompt = config.getBasePrompt() ?? buildDefaultPrompt({
      name: config.getAgentName() ?? 'Amodal Agent',
      description: config.getAgentDescription(),
      agentContext: config.getAgentContext(),
      connectionNames: Object.keys(config.getConnections()).filter((k) => k !== '_secrets'),
    });
    try {
      geminiClient.getChat().setSystemInstruction(systemPrompt);
    } catch {
      // Chat may not be initialized yet in some edge cases — non-fatal
    }

    // Remove upstream Gemini CLI built-in agents that aren't relevant to Amodal,
    // then register Amodal subagents loaded via the SDK.
    const UPSTREAM_AGENTS_TO_REMOVE = ['codebase_investigator', 'cli_help', 'generalist'];
    try {
      const upstream = config.getUpstreamConfig();
      const agentRegistry = upstream.getAgentRegistry();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const registryRaw = agentRegistry as unknown as {
        agents: Map<string, unknown>;
        allDefinitions: Map<string, unknown>;
      };
      const toolRegistry = upstream.getToolRegistry();

      // Remove upstream built-in agents
      for (const name of UPSTREAM_AGENTS_TO_REMOVE) {
        registryRaw.agents.delete(name);
        registryRaw.allDefinitions.delete(name);
        try { toolRegistry.unregisterTool(name); } catch { /* may not exist as tool */ }
      }

      // Register Amodal subagents from the deployment.
      // Bundle subagents (from SDK/platform) override platform defaults with the same name.
      // disabledSubagents from amodal.json config filters out specific agents.
      const bundleSubagents = config.getBundleSubagents();
      const disabledSubagents = new Set(config.getDisabledSubagents());

      for (const sub of bundleSubagents) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const sa = sub as { name: string; displayName: string; description: string; prompt: string; tools?: string[] };

        // Skip disabled subagents
        if (disabledSubagents.has(sa.name)) continue;

        const agentDef = {
          kind: 'local' as const,
          name: sa.name,
          displayName: sa.displayName,
          description: sa.description,
          inputConfig: {
            inputSchema: {
              type: 'object',
              properties: {
                request: { type: 'string', description: `The task for the ${sa.displayName} agent.` },
              },
              required: ['request'],
            },
          },
          modelConfig: { model: 'inherit' },
          promptConfig: { systemPrompt: sa.prompt },
          runConfig: { maxSteps: 15 },
          toolConfig: sa.tools ? { tools: sa.tools } : undefined,
        };
        registryRaw.agents.set(sa.name, agentDef);
        registryRaw.allDefinitions.set(sa.name, agentDef);
      }

      // Re-register all agents as SubagentTools so the LLM can invoke them
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const configWithSubagents = upstream as unknown as {
        registerSubAgentTools: (registry: unknown) => void;
      };
      if (typeof configWithSubagents.registerSubAgentTools === 'function') {
        configWithSubagents.registerSubAgentTools(toolRegistry);
      }
    } catch {
      // Non-fatal — registry may not be initialized
    }

    // Register store tools on the upstream tool registry.
    // This happens after config.initialize() (which ran registerAmodalTools),
    // so we need to register them separately here.
    if (storeBackend && stores.length > 0) {
      try {
        const { StoreWriteTool, StoreQueryTool } = await import('@amodalai/core');
        const upstream = config.getUpstreamConfig();
        const toolRegistry = upstream.getToolRegistry();
        const messageBus = config.getMessageBus();
        const tenantId = config.getTenantId() ?? 'default';

        for (const store of stores) {
          toolRegistry.registerTool(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tool types match upstream interface
            new StoreWriteTool(store, storeBackend, tenantId, messageBus) as never,
          );
        }
        toolRegistry.registerTool(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          new StoreQueryTool(stores, storeBackend, tenantId, messageBus) as never,
        );
        // Refresh the GeminiClient's tool list so the LLM sees the new tools
        await geminiClient.setTools();
        process.stderr.write(`[SESSION] Registered ${String(stores.length)} store tool(s) + query_store\n`);
      } catch (err) {
        process.stderr.write(`[SESSION] Failed to register store tools: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    const scheduler = new Scheduler({
      config: config.getUpstreamConfig(),
      messageBus: config.getMessageBus(),
      getPreferredEditor: () => undefined,
      schedulerId: ROOT_SCHEDULER_ID,
    });

    const now = Date.now();
    const mc = config.getModelConfig();
    const session: ManagedSession = {
      id: sessionId,
      config,
      geminiClient,
      scheduler,
      createdAt: now,
      lastAccessedAt: now,
      orgId: auth?.orgId,
      sessionType,
      pendingAskUser: new Map(),
      accumulatedMessages: [],
      model: mc?.model ?? config.getModel(),
      provider: mc?.provider,
      storeBackend,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get an existing session by ID, updating its last-accessed timestamp.
   * Returns undefined if the session doesn't exist.
   */
  get(id: string): ManagedSession | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.lastAccessedAt = Date.now();
    }
    return session;
  }

  /**
   * Hydrate a session from stored conversation history in the platform API.
   *
   * When a user sends a message to a session that expired from the in-memory
   * cache, this method fetches the conversation from the DB, creates a fresh
   * runtime session (new config, tools, KB, secrets), seeds its LLM history
   * with the stored messages, and registers it under the original conversation ID.
   *
   * Returns null if hydration cannot proceed (no platform API, missing auth,
   * fetch failure, or no stored messages).
   */
  async hydrate(
    conversationId: string,
    role?: string,
    auth?: AuthContext,
    sessionType?: string,
  ): Promise<ManagedSession | null> {
    // Guard: need platform API and auth to fetch stored conversation
    if (!this.platformApiUrl) return null;
    if (!auth?.tenantId || !auth.token) return null;

    // Deduplicate concurrent hydration requests for the same conversation
    const pending = this.pendingHydrations.get(conversationId);
    if (pending) return pending;

    const hydrationPromise = this.doHydrate(conversationId, role, auth, sessionType);
    this.pendingHydrations.set(conversationId, hydrationPromise);

    try {
      return await hydrationPromise;
    } finally {
      this.pendingHydrations.delete(conversationId);
    }
  }

  private async doHydrate(
    conversationId: string,
    role?: string,
    auth?: AuthContext,
    sessionType?: string,
  ): Promise<ManagedSession | null> {
    // Fetch stored conversation from platform-api
    const url = `${this.platformApiUrl}/api/tenants/${auth!.tenantId}/sessions/${conversationId}`;
    let record: StoredSessionRecord;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${auth!.token}`,
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);

      if (!response.ok) {
        process.stderr.write(
          `[HYDRATE] Failed to fetch conversation ${conversationId}: HTTP ${response.status}\n`,
        );
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- API response shape
      record = (await response.json()) as StoredSessionRecord;
    } catch (err: unknown) {
      process.stderr.write(
        `[HYDRATE] Error fetching conversation ${conversationId}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return null;
    }

    // No messages → nothing to hydrate
    if (!record.messages || record.messages.length === 0) return null;

    // Create a fully initialized session (fresh config, tools, KB, secrets).
    // Pin the model/provider from the original session so it survives model changes.
    const pinnedModel = record.model && record.provider
      ? { provider: record.provider, model: record.model }
      : undefined;
    const session = await this.create(role, auth, sessionType, pinnedModel);

    // Remove auto-generated ID from the Map, re-register under the original conversationId
    this.sessions.delete(session.id);
    session.id = conversationId;
    this.sessions.set(conversationId, session);

    // Convert stored messages to Gemini Content[] and seed LLM history
    const history = convertSessionMessagesToHistory(record.messages);
    if (history.length > 0) {
      session.geminiClient.setHistory(history);
    }

    // Pre-populate accumulatedMessages so saveSessionHistory() appends correctly
    session.accumulatedMessages = [...record.messages];

    process.stderr.write(
      `[HYDRATE] Hydrated conversation ${conversationId} with ${record.messages.length} messages (${history.length} history entries)\n`,
    );

    return session;
  }

  /**
   * Destroy a session, flushing its audit log.
   */
  async destroy(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    if (session.storeBackend) {
      try {
        await session.storeBackend.close();
      } catch {
        // Best-effort — PGLite may already be closed
      }
    }
    await session.config.shutdownAudit();
  }

  /**
   * Remove sessions that have been idle longer than the TTL.
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt > this.ttlMs) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      await this.destroy(id);
    }

    return expired.length;
  }

  /**
   * Shutdown all sessions and stop the cleanup timer.
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.destroy(id);
    }
  }

  /**
   * Wait for a user's response to an ask_user prompt.
   * Resolves when the user submits answers via the HTTP endpoint.
   * Rejects on timeout or if the signal is aborted.
   */
  waitForAskUserResponse(
    session: ManagedSession,
    askId: string,
    signal: AbortSignal,
  ): Promise<Record<string, string>> {
    return new Promise<Record<string, string>>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pendingAskUser.delete(askId);
        reject(new Error('ask_user response timed out'));
      }, ASK_USER_TIMEOUT_MS);

      const onAbort = () => {
        clearTimeout(timer);
        session.pendingAskUser.delete(askId);
        reject(new Error('ask_user aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      session.pendingAskUser.set(askId, {
        resolve: (answers) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          session.pendingAskUser.delete(askId);
          resolve(answers);
        },
        reject: (reason) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          session.pendingAskUser.delete(askId);
          reject(reason);
        },
      });
    });
  }

  /**
   * Resolve a pending ask_user with user-provided answers.
   * Returns true if the ask_id was found and resolved, false otherwise.
   */
  resolveAskUser(
    session: ManagedSession,
    askId: string,
    answers: Record<string, string>,
  ): boolean {
    const pending = session.pendingAskUser.get(askId);
    if (!pending) return false;
    pending.resolve(answers);
    return true;
  }

  /**
   * Number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }
}
