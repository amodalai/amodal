/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  storeDocuments,
  storeDocumentVersions,
  agentSessions,
  channelSessions,
  feedback,
  studioDrafts,
  automationConfig,
  automationRuns,
  evalSuites,
  evalRuns,
  setupState,
} from '../schema/index.js';

describe('schema table definitions', () => {
  it('exports store_documents with correct SQL name', () => {
    expect(getTableName(storeDocuments)).toBe('store_documents');
  });

  it('exports store_document_versions with correct SQL name', () => {
    expect(getTableName(storeDocumentVersions)).toBe('store_document_versions');
  });

  it('exports agent_sessions with correct SQL name', () => {
    expect(getTableName(agentSessions)).toBe('agent_sessions');
  });

  it('exports channel_sessions with correct SQL name', () => {
    expect(getTableName(channelSessions)).toBe('channel_sessions');
  });

  it('exports feedback with correct SQL name', () => {
    expect(getTableName(feedback)).toBe('feedback');
  });

  it('exports studio_drafts with correct SQL name', () => {
    expect(getTableName(studioDrafts)).toBe('studio_drafts');
  });

  it('exports automation_config with correct SQL name', () => {
    expect(getTableName(automationConfig)).toBe('automation_config');
  });

  it('exports automation_runs with correct SQL name', () => {
    expect(getTableName(automationRuns)).toBe('automation_runs');
  });

  it('exports eval_suites with correct SQL name', () => {
    expect(getTableName(evalSuites)).toBe('eval_suites');
  });

  it('exports eval_runs with correct SQL name', () => {
    expect(getTableName(evalRuns)).toBe('eval_runs');
  });

  it('exports setup_state with correct SQL name', () => {
    expect(getTableName(setupState)).toBe('setup_state');
  });

  it('setupState has all SetupState columns + identity + timestamps', () => {
    const cols = Object.keys(setupState);
    // Identity (composite primary key)
    expect(cols).toContain('agentId');
    expect(cols).toContain('scopeId');
    // SetupState fields (mirror @amodalai/types/setup-state.ts)
    expect(cols).toContain('phase');
    expect(cols).toContain('currentStep');
    expect(cols).toContain('completed');
    expect(cols).toContain('skipped');
    expect(cols).toContain('configAnswers');
    expect(cols).toContain('deferredRequests');
    expect(cols).toContain('providedContext');
    expect(cols).toContain('plan');
    // Lifecycle timestamps
    expect(cols).toContain('createdAt');
    expect(cols).toContain('updatedAt');
    expect(cols).toContain('completedAt');
  });

  it('storeDocuments has expected columns', () => {
    const cols = Object.keys(storeDocuments);
    expect(cols).toContain('appId');
    expect(cols).toContain('store');
    expect(cols).toContain('key');
    expect(cols).toContain('version');
    expect(cols).toContain('payload');
    expect(cols).toContain('meta');
    expect(cols).toContain('expiresAt');
    expect(cols).toContain('createdAt');
    expect(cols).toContain('updatedAt');
  });

  it('agentSessions has expected columns', () => {
    const cols = Object.keys(agentSessions);
    expect(cols).toContain('id');
    expect(cols).toContain('messages');
    expect(cols).toContain('tokenUsage');
    expect(cols).toContain('metadata');
    expect(cols).toContain('imageData');
    expect(cols).toContain('version');
  });

  it('evalRuns has expected columns', () => {
    const cols = Object.keys(evalRuns);
    expect(cols).toContain('id');
    expect(cols).toContain('agentId');
    expect(cols).toContain('suiteId');
    expect(cols).toContain('passRate');
    expect(cols).toContain('totalPassed');
    expect(cols).toContain('totalFailed');
    expect(cols).toContain('durationMs');
    expect(cols).toContain('costMicros');
    expect(cols).toContain('triggeredBy');
  });
});
