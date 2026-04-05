/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session Builder.
 *
 * Translates an AgentBundle (repo config) into SessionComponents: the
 * LLMProvider, ToolRegistry, PermissionChecker, system prompt, and
 * ToolContextFactory needed to create a session.
 *
 * Replaces the 150-line initialization sequence in the old SessionManager.create().
 * The builder is pure — no async callbacks, no platform awareness. The route
 * handler fetches the bundle and passes it here.
 */

import {z} from 'zod';
import type {
  AgentBundle,
  LoadedConnection,
  CustomToolExecutor,
  StoreBackend,
} from '@amodalai/types';
import type {McpManager, AdminAgentContent, FieldScrubber} from '@amodalai/core';
import {buildConnectionsMap, buildAccessConfigs} from '@amodalai/core';

import {createProvider} from '../providers/create-provider.js';
import type {LLMProvider, ProviderConfig} from '../providers/types.js';
import {createSearchProvider} from '../providers/search-provider.js';
import type {SearchProvider} from '../providers/search-provider.js';
import {createToolRegistry} from '../tools/registry.js';
import type {ToolRegistry, ToolDefinition, ToolContext} from '../tools/types.js';
import {registerStoreTools} from '../tools/store-tools.js';
import {createRequestTool, REQUEST_TOOL_NAME} from '../tools/request-tool.js';
import {createCustomToolDefinition} from '../tools/custom-tool-adapter.js';
import type {CustomToolSessionContext} from '../tools/custom-tool-adapter.js';
import {registerMcpTools} from '../tools/mcp-tool-adapter.js';
import {registerAdminFileTools} from '../tools/admin-file-tools.js';
import {
  AccessJsonPermissionChecker,
} from '../security/permission-checker.js';
import type {PermissionChecker} from '../security/permission-checker.js';
import {compileContext} from '../context/compiler.js';
import type {CompilerConnection, CompilerInput} from '../context/types.js';
import {createToolContextFactory} from './tool-context-factory.js';
import type {ToolContextFactoryOptions} from './tool-context-factory.js';
import {LOCAL_APP_ID} from '../constants.js';
import {StoreError} from '../errors.js';
import {createDispatchTool, DISPATCH_TOOL_NAME} from '../tools/dispatch-tool.js';
import {createWebSearchTool, WEB_SEARCH_TOOL_NAME} from '../tools/web-search-tool.js';
import {createFetchUrlTool, FETCH_URL_TOOL_NAME} from '../tools/fetch-url-tool.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Session type determines which content and tools are available. */
export type SessionType = 'chat' | 'admin' | 'automation';

/** Components needed to create a session via StandaloneSessionManager. */
export interface SessionComponents {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  permissionChecker: PermissionChecker;
  systemPrompt: string;
  toolContextFactory: (callId: string) => ToolContext;
  userRoles: string[];
}

/** Options for building session components. */
export interface BuildSessionComponentsOptions {
  /** The agent bundle (repo config). */
  bundle: AgentBundle;
  /** Shared store backend (lifecycle managed by the server). */
  storeBackend: StoreBackend | null;
  /** Shared MCP manager (lifecycle managed by the server). */
  mcpManager: McpManager | null;
  /** Session type — determines which content and tools are available. */
  sessionType?: SessionType;
  /** User roles for permission checks and field guidance. */
  userRoles?: string[];
  /** Pinned model override (takes precedence over bundle config). */
  pinnedModel?: {provider: string; model: string};
  /** Logger instance. */
  logger: Logger;
  /** App ID for store isolation (default: 'local'). */
  appId?: string;
  /** Custom tool executor for running compiled tool handlers. */
  toolExecutor?: CustomToolExecutor;
  /** Admin agent content (required when sessionType is 'admin'). */
  adminContent?: AdminAgentContent;
  /** Repo root path (required when sessionType is 'admin' for file tools). */
  repoRoot?: string;
  /** Callback to get the server port (for admin internal_api tool). */
  getPort?: () => number | null;
  /** Session ID for correlation in tool context (default: generated). */
  sessionId?: string;
  /** Optional field scrubber for response sanitization on ctx.request() */
  fieldScrubber?: FieldScrubber;
}

// ---------------------------------------------------------------------------
// Present tool (system tool)
// ---------------------------------------------------------------------------

const PRESENT_TOOL_NAME = 'present';

const WIDGET_TYPES = [
  'entity-card', 'entity-list', 'scope-map', 'alert-card', 'timeline',
  'comparison', 'data-table', 'score-breakdown', 'status-board',
  'credential-input', 'document-preview', 'info-card', 'metric',
] as const;

function createPresentTool(): ToolDefinition {
  return {
    description: `Show a visual widget inline in the conversation. Use to display entities, maps, alerts, timelines, score breakdowns, status boards, credential input forms, document previews, and other structured data visually instead of describing them in text.

Before first use in a session, load knowledge tagged widget_schemas for the correct data format for each widget type.

Widget selection:
- entity-card: Single entity profile or lookup result
- entity-list: Multiple entities in table format
- alert-card: Individual finding or alert with severity
- timeline: Chronological event sequence
- data-table: Structured data, comparisons, lists
- scope-map: Spatial/scope visualization
- comparison: Side-by-side entity or metric comparison
- score-breakdown: Risk/severity score with factor breakdown
- status-board: Overview of all active findings with severity
- credential-input: Securely capture connection credentials
- document-preview: Show proposed resources for approval
- info-card: Generic entity/object profile with key-value fields
- metric: Single highlighted metric with optional trend`,
    parameters: z.object({
      widget: z.enum(WIDGET_TYPES),
      data: z.record(z.unknown()),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {widget: string; data: Record<string, unknown>}): Promise<unknown> {
      // The present tool's result is consumed by the SSE layer to emit a
      // Widget event. The execute function just passes the data through.
      return {widget: params.widget, data: params.data, rendered: true};
    },
  };
}

// ---------------------------------------------------------------------------
// Stop execution tool (system tool)
// ---------------------------------------------------------------------------

const STOP_EXECUTION_TOOL_NAME = 'stop_execution';

function createStopExecutionTool(): ToolDefinition {
  return {
    description: 'Stop the current task. Call this when the task is complete, impossible, or when you need the user to take action before you can continue. Provide a reason explaining why you are stopping.',
    parameters: z.object({
      reason: z.string().describe('Why execution is stopping'),
    }),
    readOnly: true,
    metadata: {category: 'system'},

    async execute(params: {reason: string}): Promise<unknown> {
      // The __stop sentinel is checked by the EXECUTING state handler.
      // When detected, it transitions to DONE(model_stop) instead of continuing.
      return {__stop: true, reason: params.reason};
    },
  };
}

// ---------------------------------------------------------------------------
// Bundle → CompilerConnection mapping
// ---------------------------------------------------------------------------

function bundleConnectionToCompilerConnection(
  name: string,
  conn: LoadedConnection,
): CompilerConnection {
  return {
    name,
    description: undefined,
    endpoints: conn.surface
      .filter((e) => e.included)
      .map((e) => ({method: e.method, path: e.path, description: e.description})),
    entities: conn.entities,
    rules: conn.rules,
    fieldRestrictions: conn.access.fieldRestrictions?.map((fr) => ({
      entity: fr.entity,
      field: fr.field,
      policy: fr.policy,
      reason: fr.reason,
      allowedRoles: fr.allowedRoles,
    })),
    rowScoping: conn.access.rowScoping,
    alternativeLookups: conn.access.alternativeLookups,
  };
}

// ---------------------------------------------------------------------------
// Custom tool session context bridge
// ---------------------------------------------------------------------------

function buildCustomToolSessionContext(
  bundle: AgentBundle,
  connectionsMap: import('../tools/request-tool.js').ConnectionsMap,
  storeBackend: StoreBackend | null,
  appId: string,
): CustomToolSessionContext {
  // Adapt StoreBackend.put (returns StorePutResult) to CustomToolSessionContext.storeBackend.put (returns void)
  const adaptedBackend = storeBackend
    ? {
        async put(a: string, s: string, k: string, p: Record<string, unknown>, m: Record<string, unknown>) {
          await storeBackend.put(a, s, k, p, m);
        },
      }
    : undefined;

  return {
    config: {
      getConnections(): Record<string, unknown> {
        // Return processed connections map (with base_url, _request_config)
        // not raw LoadedConnection objects
        return connectionsMap;
      },
      getStores(): Array<{name: string; entity: {key: string; schema: Record<string, unknown>}}> {
        return bundle.stores.map((s) => ({
          name: s.name,
          entity: {key: s.entity.key, schema: s.entity.schema},
        }));
      },
    },
    storeBackend: adaptedBackend,
    appId,
  };
}

// ---------------------------------------------------------------------------
// Env allowlist
// ---------------------------------------------------------------------------

function collectEnvAllowlist(bundle: AgentBundle): Record<string, string | undefined> {
  const allowlist: Record<string, string | undefined> = {};
  for (const tool of bundle.tools) {
    for (const envVar of tool.env) {
      allowlist[envVar] = process.env[envVar];
    }
  }
  return allowlist;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build all session components from a bundle.
 *
 * This is the single entry point for translating repo config into runtime
 * components. The caller (route handler or session manager) provides the
 * bundle and shared resources; the builder returns everything needed to
 * create a session.
 */
export function buildSessionComponents(opts: BuildSessionComponentsOptions): SessionComponents {
  const {
    bundle,
    storeBackend,
    mcpManager,
    sessionType = 'chat',
    userRoles = [],
    pinnedModel,
    logger,
    appId = LOCAL_APP_ID,
    toolExecutor,
    adminContent,
    repoRoot,
    getPort,
    sessionId = 'pending',
    fieldScrubber,
  } = opts;

  // -------------------------------------------------------------------------
  // 1. Create LLM provider
  // -------------------------------------------------------------------------

  const bundleModel = bundle.config.models.main;
  const providerConfig: ProviderConfig = {
    provider: pinnedModel?.provider ?? bundleModel.provider,
    model: pinnedModel?.model ?? bundleModel.model,
    apiKey: resolveApiKey(pinnedModel ?? bundleModel, bundle),
    baseUrl: pinnedModel ? undefined : bundleModel.baseUrl,
    region: pinnedModel ? undefined : bundleModel.region,
  };

  const provider = createProvider(providerConfig);

  // -------------------------------------------------------------------------
  // 2. Create tool registry
  // -------------------------------------------------------------------------

  const registry = createToolRegistry();

  // -------------------------------------------------------------------------
  // 3. Register store tools
  // -------------------------------------------------------------------------

  if (storeBackend && bundle.stores.length > 0) {
    registerStoreTools(registry, bundle.stores, storeBackend, appId);
  }

  // -------------------------------------------------------------------------
  // 4. Register request tool
  // -------------------------------------------------------------------------

  const connectionsMap = buildConnectionsMap(bundle.connections, bundle.resolvedCredentials);
  const accessConfigs = buildAccessConfigs(bundle.connections);
  const connectionNames = [...bundle.connections.keys()].filter(
    (name) => bundle.connections.get(name)?.spec.protocol !== 'mcp',
  );

  if (connectionNames.length > 0) {
    registry.register(REQUEST_TOOL_NAME, createRequestTool({
      connectionsMap,
      permissionChecker: new AccessJsonPermissionChecker({
        accessConfigs,
        isDelegated: false,
      }),
    }));
  }

  // -------------------------------------------------------------------------
  // 5. Register custom tools
  // -------------------------------------------------------------------------

  if (toolExecutor) {
    const customToolSessionCtx = buildCustomToolSessionContext(bundle, connectionsMap, storeBackend, appId);
    for (const tool of bundle.tools) {
      // Skip tools with confirm: 'never' — they exist but are not callable
      if (tool.confirm === 'never') continue;

      registry.register(tool.name, createCustomToolDefinition(tool, toolExecutor, customToolSessionCtx));
    }
  }

  // -------------------------------------------------------------------------
  // 6. Register MCP tools
  // -------------------------------------------------------------------------

  if (mcpManager) {
    registerMcpTools(registry, mcpManager, logger);
  }

  // -------------------------------------------------------------------------
  // 7. Register admin file tools (admin sessions only)
  // -------------------------------------------------------------------------

  if (sessionType === 'admin' && repoRoot) {
    registerAdminFileTools(registry, repoRoot, getPort ?? (() => null));
  }

  // -------------------------------------------------------------------------
  // 8. Register present tool
  // -------------------------------------------------------------------------

  registry.register(PRESENT_TOOL_NAME, createPresentTool());

  // -------------------------------------------------------------------------
  // 9. Register stop_execution tool
  // -------------------------------------------------------------------------

  registry.register(STOP_EXECUTION_TOOL_NAME, createStopExecutionTool());

  // -------------------------------------------------------------------------
  // 10. Register dispatch_task tool (sub-agent dispatch)
  // -------------------------------------------------------------------------

  registry.register(DISPATCH_TOOL_NAME, createDispatchTool());

  // -------------------------------------------------------------------------
  // 10a. Build search provider + register web tools (if webTools configured)
  // -------------------------------------------------------------------------

  let searchProvider: SearchProvider | undefined;
  const webToolsConfig = bundle.config.webTools;
  if (webToolsConfig) {
    searchProvider = createSearchProvider(webToolsConfig);
    registry.register(WEB_SEARCH_TOOL_NAME, createWebSearchTool());
    registry.register(FETCH_URL_TOOL_NAME, createFetchUrlTool());
    logger.info('web_tools_enabled', {
      provider: webToolsConfig.provider,
      model: searchProvider.model,
    });
  } else {
    logger.info('web_tools_not_configured', {});
  }

  // -------------------------------------------------------------------------
  // 11. Build permission checker (session-level)
  // -------------------------------------------------------------------------

  const sessionPermissionChecker = new AccessJsonPermissionChecker({
    accessConfigs,
    isDelegated: sessionType === 'automation',
  });

  // -------------------------------------------------------------------------
  // 11. Compile system prompt
  // -------------------------------------------------------------------------

  const isAdmin = sessionType === 'admin';
  const skills = isAdmin && adminContent ? adminContent.skills : bundle.skills;
  const knowledge = isAdmin && adminContent ? adminContent.knowledge : bundle.knowledge;
  const agentOverride = isAdmin && adminContent ? (adminContent.agentPrompt ?? undefined) : bundle.agents.main;

  const compilerConnections: CompilerConnection[] = [];
  for (const [name, conn] of bundle.connections) {
    if (conn.spec.protocol === 'mcp') continue;
    compilerConnections.push(bundleConnectionToCompilerConnection(name, conn));
  }

  const compilerInput: CompilerInput = {
    name: bundle.config.name,
    description: bundle.config.description,
    userContext: bundle.config.userContext,
    agentOverride,
    basePrompt: bundle.config.basePrompt,
    connections: compilerConnections,
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      trigger: s.trigger,
      body: s.body,
    })),
    knowledge: knowledge.map((k) => ({
      name: k.name,
      title: k.title,
      body: k.body,
    })),
    stores: bundle.stores.map((s) => ({
      name: s.name,
      entity: {
        name: s.entity.name,
        key: s.entity.key,
        schema: s.entity.schema,
      },
    })),
    userRoles,
  };

  const compiled = compileContext(compilerInput);

  if (compiled.warnings.length > 0) {
    for (const warning of compiled.warnings) {
      logger.warn('compiler_warning', {warning});
    }
  }

  // -------------------------------------------------------------------------
  // 12. Build tool context factory
  // -------------------------------------------------------------------------

  const envAllowlist = collectEnvAllowlist(bundle);

  const factoryOpts: ToolContextFactoryOptions = {
    connectionsMap,
    storeBackend: storeBackend ?? makeThrowingStoreBackend(),
    storeDefinitions: bundle.stores,
    appId,
    envAllowlist,
    logger,
    fieldScrubber,
    sessionId,
    user: {roles: userRoles},
    ...(searchProvider ? {searchProvider} : {}),
  };

  const toolContextFactory = createToolContextFactory(factoryOpts);

  // -------------------------------------------------------------------------
  // Return components
  // -------------------------------------------------------------------------

  return {
    provider,
    toolRegistry: registry,
    permissionChecker: sessionPermissionChecker,
    systemPrompt: compiled.systemPrompt,
    toolContextFactory,
    userRoles,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub backend that throws on every operation — used when no real backend is available. */
function makeThrowingStoreBackend(): StoreBackend {
  const fail = () => { throw new StoreError('Store backend not available', {store: '', operation: 'init', context: {}}); };
  return {
    initialize: () => Promise.reject(fail()),
    get: () => Promise.reject(fail()),
    put: () => Promise.reject(fail()),
    list: () => Promise.reject(fail()),
    delete: () => Promise.reject(fail()),
    history: () => Promise.reject(fail()),
    purgeExpired: () => Promise.reject(fail()),
    close: () => Promise.resolve(),
  };
}

function resolveApiKey(
  modelConfig: {provider: string; model: string; credentials?: Record<string, string>},
  bundle: AgentBundle,
): string | undefined {
  // Check model-level credentials first
  if (modelConfig.credentials) {
    const key = modelConfig.credentials['apiKey'] ?? modelConfig.credentials['api_key'];
    if (key) return key;
  }

  // Check resolved credentials from the bundle
  if (bundle.resolvedCredentials) {
    const providerEnvKey = `${modelConfig.provider.toUpperCase()}_API_KEY`;
    if (bundle.resolvedCredentials[providerEnvKey]) {
      return bundle.resolvedCredentials[providerEnvKey];
    }
  }

  // Fall back to environment variable
  const envKey = `${modelConfig.provider.toUpperCase()}_API_KEY`;
  return process.env[envKey];
}

// Re-export constants for use in tests and state handlers
export {PRESENT_TOOL_NAME, STOP_EXECUTION_TOOL_NAME, DISPATCH_TOOL_NAME};
