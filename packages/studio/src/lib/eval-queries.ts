/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Drizzle queries for reading eval data from Postgres.
 * Used by Studio's eval pages and eval runner.
 */

import { eq, desc, evalSuites, evalRuns } from '@amodalai/db';
import { getStudioDb } from './db';

const DEFAULT_RUNS_LIMIT = 100;

/**
 * List all eval suites for an agent, ordered newest-first.
 */
export async function listEvalSuites(agentId: string) {
  const db = await getStudioDb();
  return db
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.agentId, agentId))
    .orderBy(desc(evalSuites.createdAt));
}

/**
 * Get a single eval suite by ID. Returns null if not found.
 */
export async function getEvalSuite(id: string) {
  const db = await getStudioDb();
  const rows = await db
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * List eval runs for a suite, ordered newest-first.
 */
export async function listEvalRuns(suiteId: string, limit = DEFAULT_RUNS_LIMIT) {
  const db = await getStudioDb();
  return db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.suiteId, suiteId))
    .orderBy(desc(evalRuns.createdAt))
    .limit(limit);
}

/**
 * Get a single eval run by ID. Returns null if not found.
 */
export async function getEvalRun(id: string) {
  const db = await getStudioDb();
  const rows = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create or update an eval suite from a disk definition.
 * Uses the suite name + agentId as the natural key (id = `${agentId}:${name}`).
 */
export async function upsertEvalSuite(
  agentId: string,
  name: string,
  config: Record<string, unknown>,
): Promise<void> {
  const db = await getStudioDb();
  const id = `${agentId}:${name}`;
  const now = new Date();

  await db
    .insert(evalSuites)
    .values({
      id,
      agentId,
      name,
      config,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: evalSuites.id,
      set: { name, config },
    });
}

/** Shape for inserting a new eval run. */
export interface NewEvalRun {
  id: string;
  agentId: string;
  suiteId: string;
  model: Record<string, unknown>;
  results: unknown[];
  passRate: number;
  totalPassed: number;
  totalFailed: number;
  durationMs: number;
  triggeredBy: string;
  label?: string;
  gitSha?: string;
  costMicros?: number;
}

/**
 * Insert a new eval run into the database.
 */
export async function saveEvalRun(run: NewEvalRun) {
  const db = await getStudioDb();
  await db.insert(evalRuns).values({
    id: run.id,
    agentId: run.agentId,
    suiteId: run.suiteId,
    model: run.model,
    results: run.results,
    passRate: run.passRate,
    totalPassed: run.totalPassed,
    totalFailed: run.totalFailed,
    durationMs: run.durationMs,
    triggeredBy: run.triggeredBy,
    label: run.label ?? null,
    gitSha: run.gitSha ?? null,
    costMicros: run.costMicros ?? null,
  });
}
