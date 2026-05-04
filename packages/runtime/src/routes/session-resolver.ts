/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session Resolver.
 *
 * Shared session resolution logic for all chat routes. Extracts bundle
 * resolution, session lookup/resume/create into a single function so
 * chat-stream, ai-stream, and chat routes share the same flow.
 */

import type {AgentBundle, CustomToolExecutor, StoreBackend} from '@amodalai/types';
import type {McpManager, FieldScrubber} from '@amodalai/core';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {Session} from '../session/types.js';
import type {ToolContext} from '../tools/types.js';
import type {SessionComponents, SessionType} from '../session/session-builder.js';
import {buildSessionComponents} from '../session/session-builder.js';
import {loadIntents} from '../intent/index.js';
import {loadMemoryContent} from '../tools/memory-tool.js';
import type {AuthContext} from '../middleware/auth.js';
import {SessionError} from '../errors.js';
import type {Logger} from '../logger.js';
import type {CredentialResolver} from '../credentials.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How the route resolves an AgentBundle for a given request. */
export interface BundleResolver {
  /** Static bundle for local dev (used when no deploy_id is provided). */
  staticBundle?: AgentBundle;
  /** Dynamic bundle provider for hosted mode (keyed by deploy_id + auth token). */
  bundleProvider?: (deployId: string, token?: string) => Promise<AgentBundle | null>;
}

/** Shared resources injected once at server startup. */
export interface SharedResources {
  storeBackend: StoreBackend | null;
  mcpManager: McpManager | null;
  logger: Logger;
  toolExecutor?: CustomToolExecutor;
  fieldScrubber?: FieldScrubber;
  /** Database handle for memory tool (when memory is enabled). */
  memoryDb?: NodePgDatabase<Record<string, unknown>>;
  /** Application ID for tenant scoping (defaults to 'local' in dev). */
  appId?: string;
  /**
   * Factory that builds a CredentialResolver for a given scopeId.
   * Used by connection loading to resolve scope:KEY references at session time.
   * If not provided, only env:KEY and literal values are resolved.
   */
  buildCredentialResolver?: (scopeId: string | undefined) => CredentialResolver;
}

/** Result of session resolution — includes the tool context factory for wiring into runMessage. */
export interface ResolvedSession {
  session: Session;
  toolContextFactory: (callId: string) => ToolContext;
}

/** Options for resolving a session. */
export interface ResolveSessionOptions {
  sessionManager: StandaloneSessionManager;
  bundleResolver: BundleResolver;
  shared: SharedResources;
  sessionType?: SessionType;
  deployId?: string;
  auth?: AuthContext;
  /**
   * Optional total-token budget cap. Applied only when this call creates
   * a new session; resumed sessions keep the budget set at creation.
   */
  maxSessionTokens?: number;
  /** Model override — takes precedence over bundle config for new sessions */
  pinnedModel?: {provider: string; model: string};
  /**
   * Hook called after session components are built but before the session
   * is created. Allows the hosting layer to enhance components — e.g.,
   * injecting role-based field guidance into the system prompt.
   */
  onSessionBuild?: (
    components: SessionComponents,
    context: { auth?: AuthContext; bundle: AgentBundle },
  ) => SessionComponents | Promise<SessionComponents>;
  /** Scope ID for per-user session isolation. Empty string means agent-level. */
  scopeId?: string;
  /** Additional scope context from JWT claims or request body. */
  scopeContext?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Bundle resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an AgentBundle from the bundle resolver.
 *
 * Prefers the dynamic bundleProvider when a deploy_id is available (hosted
 * mode). Falls back to the static bundle (local dev).
 */
export async function resolveBundle(
  resolver: BundleResolver,
  deployId?: string,
  token?: string,
): Promise<AgentBundle | null> {
  if (deployId && resolver.bundleProvider) {
    return resolver.bundleProvider(deployId, token);
  }
  return resolver.staticBundle ?? null;
}

// ---------------------------------------------------------------------------
// Internal: build components + wire factory
// ---------------------------------------------------------------------------

async function buildComponents(
  bundle: AgentBundle,
  shared: SharedResources,
  opts: {
    sessionType?: SessionType;
    sessionId?: string;
    pinnedModel?: {provider: string; model: string};
    scopeId?: string;
    scopeContext?: Record<string, string>;
  },
): Promise<SessionComponents> {
  // Load memory content if memory is enabled and a DB is available
  let memoryContent: string | undefined;
  const memoryDb = shared.memoryDb;
  if (bundle.config.memory?.enabled && memoryDb) {
    memoryContent = await loadMemoryContent(memoryDb, shared.appId ?? 'local', opts.scopeId ?? '');
    shared.logger.info('memory_loaded', {contentLength: memoryContent.length, scopeId: opts.scopeId ?? ''});
  }

  const credentialResolver = shared.buildCredentialResolver?.(opts.scopeId);

  // Load deterministic intents from <repoPath>/intents/. Empty array
  // when the repo doesn't have one (most agents). Loaded async here
  // because esbuild compile + dynamic import are async; the rest of
  // session building stays sync.
  const intents = bundle.source === 'local' && bundle.origin
    ? await loadIntents(bundle.origin).catch((err: unknown) => {
        shared.logger.warn('intent_load_failed', {
          repoPath: bundle.origin,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      })
    : [];

  return buildSessionComponents({
    bundle,
    storeBackend: shared.storeBackend,
    mcpManager: shared.mcpManager,
    logger: shared.logger,
    toolExecutor: shared.toolExecutor,
    fieldScrubber: shared.fieldScrubber,
    sessionType: opts.sessionType,
    sessionId: opts.sessionId,
    pinnedModel: opts.pinnedModel,
    memoryContent: memoryContent || undefined,
    memoryDb,
    appId: shared.appId,
    scopeId: opts.scopeId,
    scopeContext: opts.scopeContext,
    intents,
    ...(credentialResolver ? {credentialResolver} : {}),
  });
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

/**
 * Resolve (lookup, resume, or create) a session for a chat request.
 *
 * Flow:
 * 1. If session_id: try in-memory get → try resume from store → fall through
 * 2. Create new session from resolved bundle
 * 3. Throws SessionError if no bundle is available
 *
 * Bundle is resolved once and reused across resume and create paths to
 * avoid redundant bundleProvider calls in hosted mode.
 *
 * For in-memory sessions, the cached `toolContextFactory` from session
 * creation is reused — no redundant buildSessionComponents call.
 */
export async function resolveSession(
  sessionId: string | undefined,
  opts: ResolveSessionOptions,
): Promise<ResolvedSession> {
  const {sessionManager, bundleResolver, shared, auth} = opts;
  const scopeId = opts.scopeId ?? '';

  // 1. In-memory lookup (existing live session)
  if (sessionId) {
    const existing = sessionManager.get(sessionId);
    if (existing && existing.toolContextFactory) {
      return {session: existing, toolContextFactory: existing.toolContextFactory};
    }
  }

  // Resolve bundle once — shared between resume and create paths
  const bundle = await resolveBundle(bundleResolver, opts.deployId, auth?.token);

  // Run the onSessionBuild hook once and cache the enhanced prompt so we
  // don't make duplicate external calls (e.g. user-context fetch) when the
  // resume path misses and falls through to create.
  let hookResult: SessionComponents | null = null;
  async function enhance(components: SessionComponents): Promise<SessionComponents> {
    if (!opts.onSessionBuild) return components;
    // The hook enhances the prompt based on auth + bundle, which is the same
    // regardless of sessionId. Cache the first result and apply it to
    // subsequent components by copying the enhanced systemPrompt.
    if (!hookResult) {
      hookResult = await opts.onSessionBuild(components, {auth, bundle: bundle!});
      return hookResult;
    }
    // Reuse the enhanced prompt from the first call
    return {...components, systemPrompt: hookResult.systemPrompt};
  }

  // 1b. Scope-based session lookup: if a scopeId is provided but no session_id,
  // look up the latest session for that scope from the store.
  let resolvedSessionId = sessionId;
  if (!resolvedSessionId && scopeId && bundle) {
    const sessionStore = sessionManager.getStore();
    if (sessionStore?.findByScopeId) {
      const found = await sessionStore.findByScopeId(scopeId);
      if (found) {
        resolvedSessionId = found;
        shared.logger.info('session_resolved_by_scope', {scopeId, sessionId: found});
      }
    }
  }

  // 2. Resume from store (with dedup handled by StandaloneSessionManager)
  if (resolvedSessionId && bundle) {
    const rawComponents = await buildComponents(bundle, shared, {
      sessionType: opts.sessionType,
      sessionId: resolvedSessionId,
      pinnedModel: opts.pinnedModel,
      scopeId,
      scopeContext: opts.scopeContext,
    });
    const components = await enhance(rawComponents);

    const resumed = await sessionManager.resume(resolvedSessionId, {
      provider: components.provider,
      toolRegistry: components.toolRegistry,
      permissionChecker: components.permissionChecker,
      systemPrompt: components.systemPrompt,
      toolContextFactory: components.toolContextFactory,
      scopeId,
    });

    if (resumed) {
      return {session: resumed, toolContextFactory: components.toolContextFactory};
    }
  }

  // 3. Create new session
  if (!bundle) {
    throw new SessionError('No bundle available — provide a deploy_id or configure a static bundle', {
      sessionId: resolvedSessionId ?? 'new',
      context: {operation: 'resolveSession', deployId: opts.deployId},
    });
  }

  const rawComponents = await buildComponents(bundle, shared, {
    sessionType: opts.sessionType,
    pinnedModel: opts.pinnedModel,
    scopeId,
    scopeContext: opts.scopeContext,
  });
  const components = await enhance(rawComponents);

  const session = sessionManager.create({
    provider: components.provider,
    toolRegistry: components.toolRegistry,
    permissionChecker: components.permissionChecker,
    systemPrompt: components.systemPrompt,
    toolContextFactory: components.toolContextFactory,
    maxSessionTokens: opts.maxSessionTokens,
    appId: shared.appId,
    scopeId,
    intents: components.intents,
  });

  return {session, toolContextFactory: components.toolContextFactory};
}
