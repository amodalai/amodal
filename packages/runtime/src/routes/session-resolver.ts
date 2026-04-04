/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session Resolver (Phase 3.5c).
 *
 * Shared session resolution logic for all chat routes. Extracts bundle
 * resolution, session lookup/resume/create into a single function so
 * chat-stream, ai-stream, and chat routes share the same flow.
 */

import type {AgentBundle, CustomToolExecutor, StoreBackend} from '@amodalai/types';
import type {McpManager, FieldScrubber} from '@amodalai/core';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {Session} from '../session/types.js';
import type {SessionComponents, SessionType} from '../session/session-builder.js';
import {buildSessionComponents} from '../session/session-builder.js';
import type {AuthContext} from '../middleware/auth.js';
import {SessionError} from '../errors.js';
import type {Logger} from '../logger.js';

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
}

/** Result of session resolution — includes components for wiring into runMessage. */
export interface ResolvedSession {
  session: Session;
  components: SessionComponents;
}

/** Options for resolving a session. */
export interface ResolveSessionOptions {
  sessionManager: StandaloneSessionManager;
  bundleResolver: BundleResolver;
  shared: SharedResources;
  role?: string;
  sessionType?: SessionType;
  deployId?: string;
  auth?: AuthContext;
}

// ---------------------------------------------------------------------------
// Bundle resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an AgentBundle from the bundle resolver.
 *
 * Prefers the static bundle (local dev). Falls back to the dynamic
 * bundleProvider when a deploy_id is available (hosted mode).
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
// Session resolution
// ---------------------------------------------------------------------------

/**
 * Resolve (lookup, resume, or create) a session for a chat request.
 *
 * Flow:
 * 1. If session_id: try in-memory get → try resume from store → fall through
 * 2. Create new session from resolved bundle
 * 3. Throws SessionError if no bundle is available
 */
export async function resolveSession(
  sessionId: string | undefined,
  opts: ResolveSessionOptions,
): Promise<ResolvedSession> {
  const {sessionManager, bundleResolver, shared, auth} = opts;
  const tenantId = auth?.orgId ?? 'local';
  const userId = auth?.actor ?? 'anonymous';
  const userRoles = opts.role ? [opts.role] : [];

  // 1. In-memory lookup (existing live session)
  if (sessionId) {
    const existing = sessionManager.get(sessionId);
    if (existing) {
      // Build fresh components for the toolContextFactory — the session
      // is already live but the route needs components for buildToolContext.
      const bundle = await resolveBundle(bundleResolver, opts.deployId, auth?.token);
      if (!bundle) {
        throw new SessionError('No bundle available for existing session', {
          sessionId,
          context: {operation: 'resolveSession', deployId: opts.deployId},
        });
      }
      const components = buildSessionComponents({
        bundle,
        storeBackend: shared.storeBackend,
        mcpManager: shared.mcpManager,
        logger: shared.logger,
        toolExecutor: shared.toolExecutor,
        fieldScrubber: shared.fieldScrubber,
        sessionType: opts.sessionType,
        userRoles,
        sessionId,
        tenantId,
      });
      return {session: existing, components};
    }

    // 2. Resume from store (with dedup handled by StandaloneSessionManager)
    const bundle = await resolveBundle(bundleResolver, opts.deployId, auth?.token);
    if (bundle) {
      const components = buildSessionComponents({
        bundle,
        storeBackend: shared.storeBackend,
        mcpManager: shared.mcpManager,
        logger: shared.logger,
        toolExecutor: shared.toolExecutor,
        fieldScrubber: shared.fieldScrubber,
        sessionType: opts.sessionType,
        userRoles,
        sessionId,
        tenantId,
      });

      const resumed = await sessionManager.resume(sessionId, {
        tenantId,
        userId,
        provider: components.provider,
        toolRegistry: components.toolRegistry,
        permissionChecker: components.permissionChecker,
        systemPrompt: components.systemPrompt,
        userRoles: components.userRoles,
      });

      if (resumed) {
        return {session: resumed, components};
      }
    }

    // Fall through to create — session_id was provided but not found
  }

  // 3. Create new session
  const bundle = await resolveBundle(bundleResolver, opts.deployId, auth?.token);
  if (!bundle) {
    throw new SessionError('No bundle available — provide a deploy_id or configure a static bundle', {
      sessionId: sessionId ?? 'new',
      context: {operation: 'resolveSession', deployId: opts.deployId},
    });
  }

  const components = buildSessionComponents({
    bundle,
    storeBackend: shared.storeBackend,
    mcpManager: shared.mcpManager,
    logger: shared.logger,
    toolExecutor: shared.toolExecutor,
    fieldScrubber: shared.fieldScrubber,
    sessionType: opts.sessionType,
    userRoles,
    tenantId,
  });

  const session = sessionManager.create({
    tenantId,
    userId,
    provider: components.provider,
    toolRegistry: components.toolRegistry,
    permissionChecker: components.permissionChecker,
    systemPrompt: components.systemPrompt,
    userRoles: components.userRoles,
  });

  return {session, components};
}
