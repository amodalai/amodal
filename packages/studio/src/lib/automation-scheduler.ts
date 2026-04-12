/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Interval-based automation scheduler.
 *
 * On init, loads enabled automations from Postgres and sets up timers.
 * On fire, calls the runtime's POST /chat endpoint and records the run.
 */

import {
  listAutomations,
  recordAutomationRun,
  completeAutomationRun,
} from './automation-queries';
import { getRuntimeUrl } from './runtime-client';
import {
  notifyAutomationStarted,
  notifyAutomationCompleted,
} from '@amodalai/db';
import type { NodePgDatabase } from '@amodalai/db';
import { getStudioDb } from './db';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTOMATION_TIMEOUT_MS = 300_000; // 5 minutes
const RUNTIME_CHAT_PATH = '/chat';

// ---------------------------------------------------------------------------
// Cron → interval conversion
// ---------------------------------------------------------------------------

/**
 * Convert a simple cron expression to an interval in milliseconds.
 *
 * Supported patterns:
 * - `* /N * * * *` → every N minutes (written without space; space here avoids comment)
 * - `N * * * *`    → once per hour (at minute N) → 60 min interval
 * - `M H * * *`    → once per day (at H:M) → 24 hour interval
 *
 * Returns 0 for unsupported patterns.
 */
export function cronToIntervalMs(schedule: string): number {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return 0;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: */N * * * *
  if (minute?.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(minute.slice(2), 10);
    if (Number.isNaN(n) || n <= 0) return 0;
    return n * 60 * 1000;
  }

  // Every hour at minute N: N * * * *
  if (minute !== undefined && /^\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 60 * 60 * 1000;
  }

  // Daily at H:M: M H * * *
  if (
    minute !== undefined && /^\d+$/.test(minute) &&
    hour !== undefined && /^\d+$/.test(hour) &&
    dayOfMonth === '*' && month === '*' && dayOfWeek === '*'
  ) {
    return 24 * 60 * 60 * 1000;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

class AutomationScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * Load enabled automations from DB and start their timers.
   */
  async start(): Promise<void> {
    const automations = await listAutomations(this.agentId);
    let started = 0;

    for (const auto of automations) {
      if (auto.enabled) {
        this.scheduleOne(auto.name, auto.schedule, auto.message);
        started++;
      }
    }

    logger.info('scheduler_started', { agent_id: this.agentId, automations_scheduled: started });
  }

  /**
   * Schedule a single automation to fire on an interval.
   */
  private scheduleOne(name: string, schedule: string, message: string): void {
    // Clear any existing timer for this name
    this.clearOne(name);

    const intervalMs = cronToIntervalMs(schedule);
    if (intervalMs <= 0) {
      logger.warn('unsupported_cron_schedule', { name, schedule, agent_id: this.agentId });
      return;
    }

    const timer = setInterval(() => {
      void this.trigger(name, message).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('automation_trigger_unhandled', { name, error: errorMsg, agent_id: this.agentId });
      });
    }, intervalMs);

    this.timers.set(name, timer);
    logger.info('automation_scheduled', { name, interval_ms: intervalMs, agent_id: this.agentId });
  }

  /**
   * Trigger an automation run immediately.
   */
  async trigger(name: string, message: string): Promise<void> {
    const db = await getStudioDb();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any
    const rawDb = db as any as NodePgDatabase;

    const runId = await recordAutomationRun(this.agentId, name, null, 'running');
    await notifyAutomationStarted(rawDb, { agentId: this.agentId, name, runId });

    logger.info('automation_triggered', { name, run_id: runId, agent_id: this.agentId });

    const start = Date.now();

    try {
      const runtimeUrl = getRuntimeUrl();
      const res = await fetch(`${runtimeUrl}${RUNTIME_CHAT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, metadata: { automation: name } }),
        signal: AbortSignal.timeout(AUTOMATION_TIMEOUT_MS),
      });

      // The runtime returns a JSON response with a sessionId
      const data: unknown = await res.json();
      const sessionId =
        typeof data === 'object' && data !== null && 'sessionId' in data
          ? String((data as Record<string, unknown>)['sessionId'])
          : null;

      await completeAutomationRun(runId, 'completed', { sessionId: sessionId ?? undefined });
      await notifyAutomationCompleted(rawDb, {
        agentId: this.agentId,
        name,
        runId,
        status: 'completed',
      });

      logger.info('automation_completed', {
        name,
        run_id: runId,
        session_id: sessionId,
        duration_ms: Date.now() - start,
        agent_id: this.agentId,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await completeAutomationRun(runId, 'failed', { error: errorMsg });
      await notifyAutomationCompleted(rawDb, {
        agentId: this.agentId,
        name,
        runId,
        status: 'failed',
      });

      logger.error('automation_failed', {
        name,
        run_id: runId,
        error: errorMsg,
        duration_ms: Date.now() - start,
        agent_id: this.agentId,
      });

      // Re-throw so the interval handler's .catch() can log too
      throw err;
    }
  }

  /**
   * Enable and schedule an automation.
   */
  enableAutomation(name: string, schedule: string, message: string): void {
    this.scheduleOne(name, schedule, message);
  }

  /**
   * Disable and remove a scheduled automation.
   */
  disableAutomation(name: string): void {
    this.clearOne(name);
    logger.info('automation_disabled', { name, agent_id: this.agentId });
  }

  /**
   * Stop all timers. Called on shutdown.
   */
  stop(): void {
    for (const [name, timer] of this.timers.entries()) {
      clearInterval(timer);
      logger.debug('automation_timer_cleared', { name, agent_id: this.agentId });
    }
    this.timers.clear();
    logger.info('scheduler_stopped', { agent_id: this.agentId });
  }

  private clearOne(name: string): void {
    const existing = this.timers.get(name);
    if (existing) {
      clearInterval(existing);
      this.timers.delete(name);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let scheduler: AutomationScheduler | null = null;

/**
 * Get or create the singleton scheduler for the given agent.
 */
export function getScheduler(agentId: string): AutomationScheduler {
  if (!scheduler) {
    scheduler = new AutomationScheduler(agentId);
  }
  return scheduler;
}

/**
 * Reset the scheduler singleton. Used for testing only.
 */
export function resetScheduler(): void {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
}
