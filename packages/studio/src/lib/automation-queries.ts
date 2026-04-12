/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle queries for automation config and run history.
 * Used by Studio's automation pages and the scheduler.
 */

import { eq, and, desc, automationConfig, automationRuns } from '@amodalai/db';
import { getStudioDb } from './db';

const DEFAULT_RUNS_LIMIT = 50;

/**
 * List all automation configs for an agent, ordered by creation time.
 */
export async function listAutomations(agentId: string) {
  const db = await getStudioDb();
  return db
    .select()
    .from(automationConfig)
    .where(eq(automationConfig.agentId, agentId))
    .orderBy(desc(automationConfig.createdAt));
}

/**
 * Get a single automation config by agent + name. Returns null if not found.
 */
export async function getAutomation(agentId: string, name: string) {
  const db = await getStudioDb();
  const rows = await db
    .select()
    .from(automationConfig)
    .where(
      and(
        eq(automationConfig.agentId, agentId),
        eq(automationConfig.name, name),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create or update an automation config.
 */
export async function upsertAutomation(
  agentId: string,
  name: string,
  data: { schedule: string; message: string; enabled?: boolean },
) {
  const db = await getStudioDb();
  const now = new Date();

  await db
    .insert(automationConfig)
    .values({
      agentId,
      name,
      schedule: data.schedule,
      message: data.message,
      enabled: data.enabled ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [automationConfig.agentId, automationConfig.name],
      set: {
        schedule: data.schedule,
        message: data.message,
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        updatedAt: now,
      },
    });
}

/**
 * Enable or disable an automation.
 */
export async function setAutomationEnabled(
  agentId: string,
  name: string,
  enabled: boolean,
) {
  const db = await getStudioDb();
  await db
    .update(automationConfig)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        eq(automationConfig.agentId, agentId),
        eq(automationConfig.name, name),
      ),
    );
}

/**
 * Record a new automation run. Returns the inserted run ID.
 */
export async function recordAutomationRun(
  agentId: string,
  name: string,
  sessionId: string | null,
  status: string,
  error?: string,
) {
  const db = await getStudioDb();
  const rows = await db
    .insert(automationRuns)
    .values({
      agentId,
      name,
      sessionId,
      status,
      error: error ?? null,
      startedAt: new Date(),
      completedAt: status !== 'running' ? new Date() : null,
    })
    .returning({ id: automationRuns.id });
  return rows[0]?.id ?? 0;
}

/**
 * Update an existing run to mark it completed or failed.
 */
export async function completeAutomationRun(
  runId: number,
  status: string,
  opts?: { sessionId?: string; error?: string },
) {
  const db = await getStudioDb();
  await db
    .update(automationRuns)
    .set({
      status,
      completedAt: new Date(),
      ...(opts?.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
      ...(opts?.error !== undefined ? { error: opts.error } : {}),
    })
    .where(eq(automationRuns.id, runId));
}

/**
 * List recent runs for an automation, ordered newest-first.
 */
export async function listAutomationRuns(
  agentId: string,
  name: string,
  limit = DEFAULT_RUNS_LIMIT,
) {
  const db = await getStudioDb();
  return db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.agentId, agentId),
        eq(automationRuns.name, name),
      ),
    )
    .orderBy(desc(automationRuns.startedAt))
    .limit(limit);
}
