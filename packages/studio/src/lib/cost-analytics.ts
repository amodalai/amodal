/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {SessionHistoryRow} from './types';
import {estimateCost} from './model-pricing';

export interface CostGroup {
  key: string;
  label: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  unknownCostSessions: number;
}

export interface CostBucket {
  key: string;
  label: string;
  sessions: number;
  totalTokens: number;
  cost: number;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  knownCostSessions: number;
  unknownCostSessions: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionCost(session: SessionHistoryRow): number | null {
  return session.model
    ? estimateCost(session.model, session.token_usage.input_tokens, session.token_usage.output_tokens)
    : null;
}

export function summarizeCost(sessions: SessionHistoryRow[]): CostSummary {
  let totalCost = 0;
  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let knownCostSessions = 0;

  for (const session of sessions) {
    totalTokens += session.token_usage.total_tokens;
    totalInputTokens += session.token_usage.input_tokens;
    totalOutputTokens += session.token_usage.output_tokens;
    const cost = sessionCost(session);
    if (cost != null) {
      totalCost += cost;
      knownCostSessions += 1;
    }
  }

  return {
    totalCost,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    knownCostSessions,
    unknownCostSessions: sessions.length - knownCostSessions,
  };
}

function addToGroup(group: CostGroup, session: SessionHistoryRow, cost: number | null): void {
  group.sessions += 1;
  group.inputTokens += session.token_usage.input_tokens;
  group.outputTokens += session.token_usage.output_tokens;
  group.totalTokens += session.token_usage.total_tokens;
  if (cost == null) {
    group.unknownCostSessions += 1;
  } else {
    group.cost += cost;
  }
}

export function groupSessions(
  sessions: SessionHistoryRow[],
  keyOf: (session: SessionHistoryRow) => string,
  labelOf: (session: SessionHistoryRow) => string,
): CostGroup[] {
  const groups = new Map<string, CostGroup>();
  for (const session of sessions) {
    const key = keyOf(session);
    const existing = groups.get(key);
    const group = existing ?? {
      key,
      label: labelOf(session),
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      unknownCostSessions: 0,
    };
    addToGroup(group, session, sessionCost(session));
    if (!existing) groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
}

function bucketKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function dailyCostBuckets(sessions: SessionHistoryRow[], days = 14): CostBucket[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);

  const buckets = new Map<string, CostBucket>();
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start.getTime() + i * DAY_MS);
    buckets.set(bucketKey(date), {
      key: bucketKey(date),
      label: bucketLabel(date),
      sessions: 0,
      totalTokens: 0,
      cost: 0,
    });
  }

  for (const session of sessions) {
    const date = new Date(session.updated_at);
    date.setHours(0, 0, 0, 0);
    if (date < start || date > end) continue;
    const bucket = buckets.get(bucketKey(date));
    if (!bucket) continue;
    bucket.sessions += 1;
    bucket.totalTokens += session.token_usage.total_tokens;
    bucket.cost += sessionCost(session) ?? 0;
  }

  return [...buckets.values()];
}

export function trendDeltaPercent(buckets: CostBucket[]): number | null {
  if (buckets.length < 2) return null;
  const midpoint = Math.floor(buckets.length / 2);
  const previous = buckets.slice(0, midpoint).reduce((sum, bucket) => sum + bucket.cost, 0);
  const current = buckets.slice(midpoint).reduce((sum, bucket) => sum + bucket.cost, 0);
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

export function percentOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(2, Math.round((value / total) * 100));
}

export function scopeLabel(session: SessionHistoryRow): string {
  return session.scope_id || 'agent scope';
}
