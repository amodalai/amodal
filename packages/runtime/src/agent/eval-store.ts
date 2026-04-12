/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Postgres-backed eval store.
 *
 * Persists eval run results to the shared Postgres database via
 * Drizzle ORM. Replaces the previous file-based JSON implementation.
 */

import {eq, desc} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {getDb, evalRuns} from '@amodalai/db';
import {StoreError} from '../errors.js';

interface EvalHistoryEntry {
  runId: string;
  passed: boolean;
  durationMs: number;
  queryCostMicros: number;
  judgeCostMicros: number;
  timestamp: string;
  model: string;
  assertions: Array<{passed: boolean}>;
}

interface EvalRunSummary {
  id: string;
  model: {provider: string; model: string};
  passRate: number;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  totalCostMicros: number;
  totalCostNoCacheMicros?: number;
  label?: string;
  gitSha?: string;
  triggeredBy: string;
  createdAt: string;
}

/**
 * Persists eval run results to Postgres.
 */
export class EvalStore {
  private readonly agentId: string;
  private readonly db: NodePgDatabase;

  constructor(agentIdOrRepoPath: string) {
    // Accept either an agentId or a repoPath (for backwards compat).
    // When called from local-server, this was `config.repoPath`. We use
    // the basename as a reasonable agentId.
    this.agentId = agentIdOrRepoPath.includes('/')
      ? agentIdOrRepoPath.split('/').filter(Boolean).pop() ?? 'local'
      : agentIdOrRepoPath;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getDb returns Db which extends NodePgDatabase
    this.db = getDb() as unknown as NodePgDatabase;
  }

  async save(run: Record<string, unknown>): Promise<void> {
    const id = String(run['id'] ?? '');
    if (!id) return;

    // Extract fields from the run object to match the evalRuns schema
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted eval run data
    const model = (run['model'] ?? {provider: 'unknown', model: 'unknown'}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted eval run data
    const suite = (run['suite'] ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted eval run data
    const totalCost = (run['totalCost'] ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted eval run data
    const results = (suite['results'] ?? []) as unknown[];

    const totalPassed = Number(suite['totalPassed'] ?? 0);
    const totalFailed = Number(suite['totalFailed'] ?? 0);
    const total = totalPassed + totalFailed;

    try {
      await this.db.insert(evalRuns).values({
        id,
        agentId: this.agentId,
        suiteId: typeof run['suiteId'] === 'string' ? run['suiteId'] : 'default',
        model,
        results,
        passRate: total > 0 ? totalPassed / total : 0,
        totalPassed,
        totalFailed,
        durationMs: Number(suite['totalDurationMs'] ?? 0),
        costMicros: totalCost['estimatedCostMicros'] ? Number(totalCost['estimatedCostMicros']) : null,
        label: typeof run['label'] === 'string' ? run['label'] : null,
        gitSha: typeof run['gitSha'] === 'string' ? run['gitSha'] : null,
        triggeredBy: String(run['triggeredBy'] ?? 'manual'),
      }).onConflictDoUpdate({
        target: evalRuns.id,
        set: {
          model,
          results,
          passRate: total > 0 ? totalPassed / total : 0,
          totalPassed,
          totalFailed,
          durationMs: Number(suite['totalDurationMs'] ?? 0),
          costMicros: totalCost['estimatedCostMicros'] ? Number(totalCost['estimatedCostMicros']) : null,
          label: typeof run['label'] === 'string' ? run['label'] : null,
          gitSha: typeof run['gitSha'] === 'string' ? run['gitSha'] : null,
          triggeredBy: String(run['triggeredBy'] ?? 'manual'),
        },
      });
    } catch (err) {
      throw new StoreError('Failed to save eval run', {
        store: 'evalRuns',
        operation: 'save',
        cause: err,
        context: {agentId: this.agentId, runId: id},
      });
    }
  }

  async load(id: string): Promise<Record<string, unknown> | null> {
    try {
      const rows = await this.db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.id, id))
        .limit(1);

      if (rows.length === 0) return null;
      return this.rowToRecord(rows[0]);
    } catch (err) {
      throw new StoreError('Failed to load eval run', {
        store: 'evalRuns',
        operation: 'load',
        cause: err,
        context: {agentId: this.agentId, runId: id},
      });
    }
  }

  async list(): Promise<EvalRunSummary[]> {
    try {
      const rows = await this.db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.agentId, this.agentId))
        .orderBy(desc(evalRuns.createdAt));

      return rows.map((r) => ({
        id: r.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSONB model object
        model: (r.model ?? {provider: 'unknown', model: 'unknown'}) as {provider: string; model: string},
        passRate: r.passRate,
        totalPassed: r.totalPassed,
        totalFailed: r.totalFailed,
        totalDurationMs: r.durationMs,
        totalCostMicros: r.costMicros ?? 0,
        label: r.label ?? undefined,
        gitSha: r.gitSha ?? undefined,
        triggeredBy: r.triggeredBy,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch (err) {
      throw new StoreError('Failed to list eval runs', {
        store: 'evalRuns',
        operation: 'list',
        cause: err,
        context: {agentId: this.agentId},
      });
    }
  }

  async listByEval(evalName: string): Promise<EvalHistoryEntry[]> {
    try {
      const rows = await this.db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.agentId, this.agentId))
        .orderBy(desc(evalRuns.createdAt));

      const entries: EvalHistoryEntry[] = [];
      for (const row of rows) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSONB results array
        const results = (row.results ?? []) as Array<Record<string, unknown>>;
         
        const modelInfo = (row.model ?? {});

        for (const r of results) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- eval result structure
          const ev = (r['eval'] ?? {}) as Record<string, unknown>;
          if (String(ev['name'] ?? '') !== evalName) continue;

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cost info
          const cost = (r['cost'] ?? {}) as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- assertion results
          const assertionResults = (r['assertions'] ?? []) as Array<Record<string, unknown>>;

          entries.push({
            runId: row.id,
            passed: Boolean(r['passed']),
            durationMs: Number(r['durationMs'] ?? 0),
            queryCostMicros: Number(cost['estimatedCostMicros'] ?? 0),
            judgeCostMicros: 0,
            timestamp: row.createdAt.toISOString(),
            model: String(modelInfo['model'] ?? 'unknown'),
            assertions: assertionResults.map((a) => ({passed: Boolean(a['passed'])})),
          });
        }
      }

      return entries;
    } catch (err) {
      throw new StoreError('Failed to list eval history', {
        store: 'evalRuns',
        operation: 'listByEval',
        cause: err,
        context: {agentId: this.agentId, evalName},
      });
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const deleted = await this.db
        .delete(evalRuns)
        .where(eq(evalRuns.id, id))
        .returning({id: evalRuns.id});

      return deleted.length > 0;
    } catch (err) {
      throw new StoreError('Failed to delete eval run', {
        store: 'evalRuns',
        operation: 'delete',
        cause: err,
        context: {agentId: this.agentId, runId: id},
      });
    }
  }

  private rowToRecord(row: typeof evalRuns.$inferSelect): Record<string, unknown> {
    return {
      id: row.id,
      agentId: row.agentId,
      suiteId: row.suiteId,
      model: row.model,
      suite: {
        results: row.results,
        totalPassed: row.totalPassed,
        totalFailed: row.totalFailed,
        totalDurationMs: row.durationMs,
        timestamp: row.createdAt.toISOString(),
      },
      totalCost: row.costMicros ? {estimatedCostMicros: row.costMicros} : {},
      passRate: row.passRate,
      label: row.label,
      gitSha: row.gitSha,
      triggeredBy: row.triggeredBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
