/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import {
  notifyStoreUpdated,
  notifySessionUpdated,
  notifyFeedbackCreated,
  notifyAutomationStarted,
  notifyAutomationCompleted,
  NOTIFY_CHANNELS,
} from '../notify.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

function createMockDb(): NodePgDatabase & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
  } as unknown as NodePgDatabase & { execute: ReturnType<typeof vi.fn> };
}

describe('notify wrappers', () => {
  it('NOTIFY_CHANNELS contains all expected channels', () => {
    expect(NOTIFY_CHANNELS).toContain('store_updated');
    expect(NOTIFY_CHANNELS).toContain('session_updated');
    expect(NOTIFY_CHANNELS).toContain('feedback_created');
    expect(NOTIFY_CHANNELS).toContain('automation_started');
    expect(NOTIFY_CHANNELS).toContain('automation_completed');
    expect(NOTIFY_CHANNELS).toHaveLength(5);
  });

  it('notifyStoreUpdated calls db.execute', async () => {
    const db = createMockDb();
    await notifyStoreUpdated(db, {agentId: 'a1', store: 's1', key: 'k1'});
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('notifySessionUpdated calls db.execute', async () => {
    const db = createMockDb();
    await notifySessionUpdated(db, {sessionId: 'sess-1'});
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('notifyFeedbackCreated calls db.execute', async () => {
    const db = createMockDb();
    await notifyFeedbackCreated(db, {feedbackId: 'f1', agentId: 'a1', sessionId: 's1'});
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('notifyAutomationStarted calls db.execute', async () => {
    const db = createMockDb();
    await notifyAutomationStarted(db, {agentId: 'a1', name: 'daily', runId: 1});
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('notifyAutomationCompleted calls db.execute', async () => {
    const db = createMockDb();
    await notifyAutomationCompleted(db, {agentId: 'a1', name: 'daily', runId: 1, status: 'completed'});
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
