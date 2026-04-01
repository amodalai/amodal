/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

interface EvalRunSummary {
  id: string;
  model: {provider: string; model: string};
  passRate: number;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  totalCostMicros: number;
  label?: string;
  gitSha?: string;
  triggeredBy: string;
  createdAt: string;
}

/**
 * Persists eval run results to disk.
 * Runs are stored as JSON files in .amodal/evals/ under the repo root.
 */
export class EvalStore {
  private readonly dir: string;

  constructor(repoPath: string) {
    this.dir = join(repoPath, '.amodal', 'evals');
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, {recursive: true});
    }
  }

  private resolvePath(id: string): string | null {
    const trimmed = id.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
    const resolved = resolve(this.dir, `${trimmed}.json`);
    if (!resolved.startsWith(resolve(this.dir) + '/')) return null;
    return resolved;
  }

  save(run: Record<string, unknown>): void {
    const id = String(run['id'] ?? '');
    const file = this.resolvePath(id);
    if (!file) return;
    this.ensureDir();
    writeFileSync(file, JSON.stringify(run, null, 2));
  }

  load(id: string): Record<string, unknown> | null {
    const file = this.resolvePath(id);
    if (!file || !existsSync(file)) return null;
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file
    return raw as Record<string, unknown>;
  }

  list(): EvalRunSummary[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    const runs: EvalRunSummary[] = [];

    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(this.dir, file), 'utf-8'));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file
        const data = raw as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file
        const model = (data['model'] ?? {provider: 'unknown', model: 'unknown'}) as {provider: string; model: string};
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file
        const suite = (data['suite'] ?? {}) as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file
        const totalCost = (data['totalCost'] ?? {}) as Record<string, unknown>;

        runs.push({
          id: String(data['id'] ?? file.replace('.json', '')),
          model,
          passRate: Number(suite['totalPassed'] ?? 0) / Math.max(Number(suite['totalPassed'] ?? 0) + Number(suite['totalFailed'] ?? 0), 1),
          totalPassed: Number(suite['totalPassed'] ?? 0),
          totalFailed: Number(suite['totalFailed'] ?? 0),
          totalDurationMs: Number(suite['totalDurationMs'] ?? 0),
          totalCostMicros: Number(totalCost['estimatedCostMicros'] ?? 0),
          label: typeof data['label'] === 'string' ? data['label'] : undefined,
          gitSha: typeof data['gitSha'] === 'string' ? data['gitSha'] : undefined,
          triggeredBy: String(data['triggeredBy'] ?? 'manual'),
          createdAt: String(data['createdAt'] ?? suite['timestamp'] ?? new Date().toISOString()),
        });
      } catch {
        // Skip corrupt files
      }
    }

    return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  delete(id: string): boolean {
    const file = this.resolvePath(id);
    if (!file || !existsSync(file)) return false;
    unlinkSync(file);
    return true;
  }
}
