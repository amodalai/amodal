/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import cron from 'node-cron';
import type { AutomationDefinition } from '@amodalai/core';
import type { AutomationRunnerFn } from './heartbeat-runner.js';

interface ScheduledJob {
  automation: AutomationDefinition;
  task: cron.ScheduledTask;
}

/**
 * Registers in-process cron jobs from automation definitions.
 * Only registers automations with trigger type "cron".
 */
export class AutomationScheduler {
  private readonly jobs: ScheduledJob[] = [];

  /**
   * Register cron automations and start them.
   */
  start(
    automations: AutomationDefinition[],
    runAutomation: AutomationRunnerFn,
  ): void {
    const cronAutomations = automations.filter(
      (a) => a.trigger.type === 'cron',
    );

    for (const a of cronAutomations) {
      if (a.trigger.type !== 'cron') continue;

      const schedule = a.trigger.schedule;
      if (!cron.validate(schedule)) {
        process.stderr.write(
          `[WARN] Invalid cron schedule for automation "${a.name}": ${schedule}\n`,
        );
        continue;
      }

      const task = cron.schedule(schedule, () => {
        void runAutomation(a).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[ERROR] Cron automation "${a.name}" failed: ${message}\n`,
          );
        });
      });

      this.jobs.push({ automation: a, task });
    }

    if (this.jobs.length > 0) {
      process.stderr.write(
        `[INFO] Registered ${this.jobs.length} cron automation(s)\n`,
      );
    }
  }

  /**
   * Stop all scheduled cron jobs.
   */
  stop(): void {
    for (const job of this.jobs) {
      job.task.stop();
    }
    this.jobs.length = 0;
  }

  /**
   * Number of registered cron jobs.
   */
  get size(): number {
    return this.jobs.length;
  }
}
