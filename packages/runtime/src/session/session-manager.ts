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
  PlanModeManager,
  McpManager,
  ensureAdminAgent,
  loadAdminAgent,
} from '@amodalai/core';
import type { AmodalRepo, CustomToolExecutor, CustomShellExecutor, StoreBackend } from '@amodalai/core';
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
  storeBackend?: StoreBackend;
  /** Plan mode manager (local dev) */
  planModeManager?: PlanModeManager;
  /** MCP server manager (local dev) */
  mcpManager?: McpManager;
  /** Session title */
  title?: string;
  /** Custom tool executor (local dev) */
  toolExecutor?: CustomToolExecutor;
  /** Custom shell executor (local dev) */
  shellExecutor?: CustomShellExecutor;
  /** App ID for this session */
  appId?: string;
}

/** Shape of a stored session record (from platform API or session store). */
export interface StoredSessionRecord {
  id: string;
  app_id: string;
  messages: SessionMessage[];
  status: string;
  model?: string;
  provider?: string;
}

/**
 * Pluggable session store for loading stored session history.
 * Implementations are provided by the hosting layer.
 */
export interface SessionStore {
  /** Fetch a stored session record by ID. Returns null if not found. */
  getSession(appId: string, sessionId: string, token: string): Promise<StoredSessionRecord | null>;
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
  /** Repo for local dev mode — sessions initialized from repo config instead of platform API */
  repo?: AmodalRepo;
  /** Custom tool executor (local dev) */
  toolExecutor?: CustomToolExecutor;
  /** Custom shell executor (local dev) */
  shellExecutor?: CustomShellExecutor;
  /** Shared store backend (local dev) */
  storeBackend?: StoreBackend;
  /** Pluggable session store for hydration (if not provided, falls back to platform API) */
  sessionStore?: SessionStore;
}

/**
 * Resolve env: references in a string record.
 * "env:VAR_NAME" → process.env.VAR_NAME value
 */
function resolveEnvRefs(record: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value.startsWith('env:')) {
      const envVar = value.slice(4);
      resolved[key] = process.env[envVar] ?? '';
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ASK_USER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages per-request sessions: creates Config + GeminiClient + Scheduler
 * instances, tracks them by ID, and cleans up expired sessions.
 */
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private baseParams: AmodalConfigParameters;
  private readonly ttlMs: number;
  private readonly platformApiUrl?: string;
  private repo?: AmodalRepo;
  private readonly toolExecutor?: CustomToolExecutor;
  private readonly shellExecutor?: CustomShellExecutor;
  private readonly sharedStoreBackend?: StoreBackend;
  private readonly sessionStore?: SessionStore;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** Deduplicates concurrent hydration requests for the same conversation */
  private readonly pendingHydrations = new Map<string, Promise<ManagedSession | null>>();
  /** Persistent MCP manager for inspect operations (lazy-initialized) */
  private inspectMcp?: McpManager;
  private inspectMcpInitialized = false;

  constructor(options: SessionManagerOptions) {
    this.baseParams = options.baseParams;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.platformApiUrl = options.platformApiUrl;
    this.repo = options.repo;
    this.toolExecutor = options.toolExecutor;
    this.shellExecutor = options.shellExecutor;
    this.sharedStoreBackend = options.storeBackend;
    this.sessionStore = options.sessionStore;

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
   * the caller's API key and org/app context.
   */
  async create(role?: string, auth?: AuthContext, sessionType?: string, pinnedModel?: { provider: string; model: string }, deployId?: string): Promise<ManagedSession> {
    const sessionId = randomUUID();
    const sessionParams: AmodalConfigParameters = {
      ...this.baseParams,
      sessionId,
      approvalMode: ApprovalMode.YOLO,
      interactive: false,
      noBrowser: true,
      // Build coreTools list based on repo config
      coreTools: this.repo ? this.buildCoreToolsList(this.repo) : [],
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

    // Inject repo config into session params when in local mode
    if (this.repo) {
      const { buildConnectionsMap } = await import('@amodalai/core');
      const connectionsMap = buildConnectionsMap(this.repo.connections);
      sessionParams.connections = connectionsMap;
      sessionParams.appDocuments = this.repo.knowledge.map((k) => ({
        id: k.name,
        scope_type: 'application' as const,
        scope_id: 'local',
        title: k.title ?? k.name,
        category: 'system_docs' as const,
        body: k.body,
        tags: [],
        status: 'active',
        created_by: 'local',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      sessionParams.bundleSkills = this.repo.skills.map((s) => ({
        name: s.name,
        description: s.description ?? '',
        body: s.body,
      }));
      sessionParams.basePrompt = this.repo.config.basePrompt;
      sessionParams.agentName = this.repo.config.name;
      sessionParams.agentContext = this.repo.config.description;

      // Model config from repo
      const mainModel = this.repo.config.models?.main;
      if (mainModel) {
        sessionParams.modelConfig = {
          provider: mainModel.provider ?? 'anthropic',
          model: mainModel.model,
        };
      }

      // Stores
      if (this.repo.stores.length > 0) {
        sessionParams.stores = this.repo.stores;
      }
    }

    let config: AmodalConfig;

    // Platform session: use AgentSDK to fetch KB docs, org details, secrets
    if (auth?.token && this.platformApiUrl) {
      process.stderr.write(
        `[SESSION] Creating platform session: app=${auth.applicationId}, ` +
        `org=${auth.orgId}, key=${auth.token.slice(0, 12)}..., sessionType=${sessionType ?? '(none)'}\n`,
      );
      const sdk = new AgentSDK(
        {
          platform: {
            apiUrl: this.platformApiUrl,
            apiKey: auth.token, // JWT or ak_ key — both work as Bearer tokens
          },
          applicationId: auth.applicationId,
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
        if (auth.apiKey) {
          sessionParams.platformApiKey = auth.apiKey;
        }
      }

      config = new AmodalConfig(sessionParams);

      // For non-platform sessions, skip the full upstream Config.initialize()
      // which hangs trying to scan files, discover agents, and authenticate
      // with Gemini. Instead, do a minimal init:
      // 1. initializeAuth() — sets up MultiProviderContentGenerator for non-Google
      // 2. registerTools() — registers amodal tools on the upstream registry
      //
      // We need to manually create the tool registry and message bus since
      // the upstream Config only creates them in _initialize().
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const upstreamRaw = config.getUpstreamConfig() as unknown as Record<string, unknown>;

      // Initialize storage (required by many upstream components)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const storage = (upstreamRaw['storage'] ?? upstreamRaw['_storage']) as { initialize?: () => Promise<void> } | undefined;
      if (storage?.initialize) {
        await storage.initialize();
      }
      // Create agent registry and tool registry if not already created
      if (!upstreamRaw['toolRegistry'] && !upstreamRaw['_toolRegistry']) {
        // Agent registry must exist before tool registry (createToolRegistry references it).
        // Use a minimal stub — we register Amodal subagents separately.
        if (!upstreamRaw['agentRegistry']) {
          upstreamRaw['agentRegistry'] = {
            getAllDefinitions: () => [],
            agents: new Map(),
            allDefinitions: new Map(),
            initialize: async () => {},
          };
        }
        // Prompt registry stub (referenced by some tools)
        if (!upstreamRaw['promptRegistry']) {
          upstreamRaw['promptRegistry'] = { getPrompts: () => [] };
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const upstreamConfig = config.getUpstreamConfig() as unknown as { createToolRegistry: () => Promise<unknown> };
        const registry = await upstreamConfig.createToolRegistry();
        upstreamRaw['_toolRegistry'] = registry;
      }

      // Initialize auth (replaces content generator for non-Google providers)
      await config.initializeAuth();

      // Register amodal tools (request, present, knowledge, stores)
      await config.registerTools();

      // Register custom tools from repo tools/ directory
      if (this.repo && this.repo.tools.length > 0) {
        const { CustomToolAdapter } = await import('./custom-tool-adapter.js');
        const { LocalToolExecutor } = await import('../agent/tool-executor-local.js');
        const executor = this.toolExecutor ?? new LocalToolExecutor();
        const registry = config.getUpstreamConfig().getToolRegistry();
        // Session isn't created yet — we'll set it after session construction
        // For now store the tools to register after session is built
        for (const tool of this.repo.tools) {
          if (tool.confirm === 'never') continue; // hidden from LLM
          // Create a placeholder session for the adapter — will be updated below
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial session for tool context
          const placeholder = { config, toolExecutor: executor } as unknown as ManagedSession;
          const adapter = new CustomToolAdapter(tool, placeholder, executor);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- adapter matches upstream tool interface
          registry.registerTool(adapter as never);
        }
        process.stderr.write(`[SESSION] Registered ${String(this.repo.tools.length)} custom tool(s)\n`);
      }

      // Set model on upstream config so GeminiClient.startChat() can resolve it
      if (sessionParams.modelConfig?.model) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const upstreamForModel = config.getUpstreamConfig() as unknown as { model?: string; _model?: string };
        if (!upstreamForModel.model && !upstreamForModel._model) {
          upstreamForModel['model'] = sessionParams.modelConfig.model;
          upstreamForModel['_model'] = sessionParams.modelConfig.model;
        }
      }

      // Initialize the GeminiClient (creates the Chat instance)
      // Must happen after tool registry and content generator are set up.
      const gemClient = config.getGeminiClient();
      if (!gemClient.isInitialized()) {
        await gemClient.initialize();
      }
    }

    // Inject app secrets as process env vars so shell_exec commands can
    // reference them (e.g. $API_BASE_URL in curl commands). The shell execution
    // service inherits process.env for child processes.
    // Also add secret names to the sanitization allowlist — without this,
    // names like API_KEY get stripped by the /KEY/i pattern.
    const connections = config.getConnections();
    const connKeys = Object.keys(connections).filter((k) => k !== '_secrets');
    process.stderr.write(`[SESSION] connections: ${connKeys.join(', ') || '(none)'}\n`);
    // App secrets are available to tools via session-scoped getSessionEnv()
    // (through ToolContext). They are NOT injected into process.env to prevent
    // cross-app secret leakage in multi-session runtimes.
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
    // In local dev mode, use the shared store backend from options.
    const stores = config.getStores();
    let storeBackend: StoreBackend | undefined = this.sharedStoreBackend;
    if (stores.length > 0 && !storeBackend) {
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
        const appId = config.getAppId() ?? 'default';

        for (const store of stores) {
          toolRegistry.registerTool(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tool types match upstream interface
            new StoreWriteTool(store, storeBackend, appId, messageBus) as never,
          );
        }
        toolRegistry.registerTool(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          new StoreQueryTool(stores, storeBackend, appId, messageBus) as never,
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
      planModeManager: new PlanModeManager(),
      toolExecutor: this.toolExecutor,
      shellExecutor: this.shellExecutor,
      appId: auth?.applicationId,
    };

    // Initialize MCP servers if repo has MCP connections
    if (this.repo) {
      await this.initMcp(session, this.repo);
    }

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
    if (!auth?.applicationId || !auth.token) return null;

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
    // Fetch stored conversation via pluggable session store
    if (!this.sessionStore || !auth?.applicationId || !auth.token) {
      return null;
    }

    let record: StoredSessionRecord | null;
    try {
      record = await this.sessionStore.getSession(auth.applicationId, conversationId, auth.token);
    } catch (err: unknown) {
      process.stderr.write(
        `[HYDRATE] Error fetching conversation ${conversationId}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return null;
    }

    if (!record) return null;

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

  // ---------------------------------------------------------------------------
  // Local dev features
  // ---------------------------------------------------------------------------

  /**
   * Get the repo (local dev mode).
   */
  getRepo(): AmodalRepo | undefined {
    return this.repo;
  }

  /**
   * Update the repo for new sessions (hot reload).
   * Existing sessions keep their old config.
   */
  updateRepo(repo: AmodalRepo): void {
    this.repo = repo;
    // Reset inspect MCP manager so it picks up new connections
    this.inspectMcpInitialized = false;
    this.inspectMcp = undefined;
  }

  /**
   * Re-register a session under a different ID (e.g., restoring original ID on session restore).
   */
  reregister(session: ManagedSession, newId: string): void {
    this.sessions.delete(session.id);
    session.id = newId;
    this.sessions.set(newId, session);
  }

  /**
   * Create an admin session for the config chat.
   * Uses admin agent skills/knowledge but the current repo's connections.
   */
  async createAdminSession(): Promise<ManagedSession> {
    if (!this.repo) {
      throw new Error('Admin sessions require a repo');
    }
    const agentDir = await ensureAdminAgent(this.repo.origin);
    const adminContent = await loadAdminAgent(agentDir);

    // Create a session with admin context
    // The admin session uses the same create() flow but with overridden prompts
    const session = await this.create('admin');

    // Override system prompt with admin agent prompt
    if (adminContent.agentPrompt) {
      try {
        session.geminiClient.getChat().setSystemInstruction(adminContent.agentPrompt);
      } catch {
        // Non-fatal
      }
    }

    session.appId = 'admin';
    return session;
  }

  /**
   * Get a persistent MCP manager for inspect/health operations.
   * Lazy-initialized on first call, reused across requests.
   */
  async getInspectMcpManager(): Promise<McpManager | undefined> {
    if (this.inspectMcpInitialized) return this.inspectMcp;
    this.inspectMcpInitialized = true;

    if (!this.repo) return undefined;

    // Build MCP server configs from repo connections
    const mcpServers = this.buildMcpConfigs(this.repo);
    if (Object.keys(mcpServers).length === 0) return undefined;

    const manager = new McpManager();
    try {
      await manager.startServers(mcpServers);
      this.inspectMcp = manager;
      return manager;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[INSPECT] MCP initialization failed: ${msg}\n`);
      this.inspectMcp = manager;
      return manager;
    }
  }

  /**
   * Initialize MCP servers for a session from repo connections.
   */
  private async initMcp(session: ManagedSession, repo: AmodalRepo): Promise<void> {
    const mcpServers = this.buildMcpConfigs(repo);
    if (Object.keys(mcpServers).length === 0) return;

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
   * Build the list of upstream core tools to enable based on repo config.
   * Only tools relevant to the Amodal runtime are included.
   */
  private buildCoreToolsList(repo: AmodalRepo): string[] {
    const tools: string[] = [
      // Always available
      'enter_plan_mode',
      'exit_plan_mode',
      'ask_user',
    ];

    // Shell execution (opt-in via config.sandbox.shellExec)
    if (repo.config.sandbox?.shellExec) {
      tools.push('shell');
    }

    return tools;
  }

  /**
   * Build MCP server configs from repo connections.
   */
  private buildMcpConfigs(repo: AmodalRepo): Record<string, { transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean }> {
    const mcpServers: Record<string, { transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; trust?: boolean }> = {};

    for (const [name, conn] of repo.connections) {
      if (conn.spec.protocol === 'mcp') {
        const resolvedHeaders = conn.spec.headers ? resolveEnvRefs(conn.spec.headers) : undefined;
        const resolvedEnv = conn.spec.env ? resolveEnvRefs(conn.spec.env) : undefined;
        mcpServers[name] = {
          transport: conn.spec.transport ?? 'stdio',
          command: conn.spec.command,
          args: conn.spec.args,
          env: resolvedEnv,
          url: conn.spec.url,
          headers: resolvedHeaders,
          trust: conn.spec.trust,
        };
      }
    }

    if (repo.mcpServers) {
      for (const [name, config] of Object.entries(repo.mcpServers)) {
        if (!mcpServers[name]) {
          mcpServers[name] = config;
        }
      }
    }

    return mcpServers;
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

    // Shutdown MCP managers for all sessions
    for (const session of this.sessions.values()) {
      if (session.mcpManager) {
        await session.mcpManager.shutdown().catch(() => {});
      }
    }

    // Shutdown persistent inspect MCP manager
    if (this.inspectMcp) {
      await this.inspectMcp.shutdown().catch(() => {});
      this.inspectMcp = undefined;
      this.inspectMcpInitialized = false;
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
