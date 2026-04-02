/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {randomUUID} from 'node:crypto';

import type {AgentBundle} from '../repo/repo-types.js';
import type {CompiledContext, SessionConfig} from './runtime-types.js';
import type {ConnectionsMap} from '../templates/connections.js';
import type {RuntimeTelemetryEvent} from './telemetry-hooks.js';
import {ScrubTracker} from '../security/scrub-tracker.js';
import {FieldScrubber} from '../security/field-scrubber.js';
import {OutputGuard} from '../security/output-guard.js';
import {ActionGate} from '../security/action-gate.js';
import {TokenAllocator, getModelContextWindow} from './token-allocator.js';
import {ContextCompiler} from './context-compiler.js';
import {OutputPipeline} from './output-pipeline.js';
import {RuntimeTelemetry} from './telemetry-hooks.js';
import {buildAccessConfigs, buildConnectionsMap} from './connection-bridge.js';
import {
  resolveScopeLabels,
  generateFieldGuidance,
  generateAlternativeLookupGuidance,
} from './user-context.js';

/**
 * Options for setting up a new session.
 */
export interface SessionSetupOptions {
  repo: AgentBundle;
  userId?: string;
  userRoles?: string[];
  isDelegated?: boolean;
  telemetrySink?: (event: RuntimeTelemetryEvent) => void;
}

/**
 * The fully initialized session runtime — all components ready.
 */
export interface SessionRuntime {
  repo: AgentBundle;
  scrubTracker: ScrubTracker;
  fieldScrubber: FieldScrubber;
  outputGuard: OutputGuard;
  actionGate: ActionGate;
  contextCompiler: ContextCompiler;
  compiledContext: CompiledContext;
  exploreContext: CompiledContext;
  outputPipeline: OutputPipeline;
  telemetry: RuntimeTelemetry;
  connectionsMap: ConnectionsMap;
  userRoles: string[];
  sessionId: string;
  isDelegated: boolean;
}

/**
 * Sets up a complete session runtime from a loaded repo.
 *
 * This is synchronous — the repo must already be loaded and no HTTP calls
 * are made. All security components, context compilation, and telemetry
 * are initialized and ready for use.
 */
export function setupSession(options: SessionSetupOptions): SessionRuntime {
  const {repo} = options;
  const isDelegated = options.isDelegated ?? false;
  const userRoles = options.userRoles ?? [];
  const sessionId = randomUUID();

  // Build connection maps
  const accessConfigs = buildAccessConfigs(repo.connections);
  const connectionsMap = buildConnectionsMap(repo.connections);

  // Resolve scope and field guidance
  const {scopeLabels, scopeRules} = resolveScopeLabels(repo.connections, userRoles);
  const fieldGuidance = generateFieldGuidance(repo.connections, userRoles);
  const alternativeLookupGuidance = generateAlternativeLookupGuidance(repo.connections);

  // Security components
  const scrubTracker = new ScrubTracker();
  const fieldScrubber = new FieldScrubber({
    accessConfigs,
    userRoles,
    tracker: scrubTracker,
  });
  const outputGuard = new OutputGuard({
    tracker: scrubTracker,
    accessConfigs,
    userRoles,
    scopeContext: {scopeRules, scopeLabels},
  });
  const actionGate = new ActionGate({
    accessConfigs,
    isDelegated,
  });

  // Context compilation
  const modelWindow = getModelContextWindow(repo.config.models.main.model);
  const allocator = new TokenAllocator(modelWindow);
  const contextCompiler = new ContextCompiler({repo, allocator});

  const sessionConfig: SessionConfig = {
    repo,
    userRoles,
    scopeLabels,
    fieldGuidance,
    alternativeLookupGuidance,
    planMode: false,
    isDelegated,
    sessionId,
  };

  const compiledContext = contextCompiler.compile(sessionConfig);
  const exploreContext = contextCompiler.compileExplore(sessionConfig);

  // Output pipeline
  const outputPipeline = new OutputPipeline({outputGuard});

  // Telemetry
  const telemetry = new RuntimeTelemetry(sessionId, options.telemetrySink);

  return {
    repo,
    scrubTracker,
    fieldScrubber,
    outputGuard,
    actionGate,
    contextCompiler,
    compiledContext,
    exploreContext,
    outputPipeline,
    telemetry,
    connectionsMap,
    userRoles,
    sessionId,
    isDelegated,
  };
}
