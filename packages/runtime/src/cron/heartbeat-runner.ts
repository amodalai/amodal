/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AutomationDefinition } from '@amodalai/core';
import type { AutomationResult } from '../types.js';
import type { SessionManager } from '../session/session-manager.js';
import { runMessage, type StreamHooks } from '../session/session-runner.js';
import { routeOutput } from '../output/output-router.js';
import { log } from '../logger.js';

export type AutomationRunnerFn = (
  automation: AutomationDefinition,
  payload?: Record<string, unknown>,
) => Promise<AutomationResult>;

export interface AutomationRunnerOptions {
  sessionManager: SessionManager;
  /** Lifecycle hooks for audit, usage reporting, and session persistence */
  streamHooks?: StreamHooks;
}

/**
 * Create an automation runner function.
 * Each invocation creates an ephemeral session, runs the prompt, routes output,
 * and destroys the session.
 */
export function createAutomationRunner(
  options: AutomationRunnerOptions,
): AutomationRunnerFn {
  return async (
    automation: AutomationDefinition,
    payload?: Record<string, unknown>,
  ): Promise<AutomationResult> => {
    const startTime = Date.now();

    let session;
    try {
      session = await options.sessionManager.create();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Automation "${automation.name}" failed to create session: ${message}`, 'automation');
      return {
        automation: automation.name,
        response: '',
        tool_calls: [],
        output_sent: false,
        duration_ms: Date.now() - startTime,
      };
    }

    try {
      // Build prompt — optionally include payload data
      let prompt = automation.prompt;
      if (payload && Object.keys(payload).length > 0) {
        prompt += `\n\nEvent data: ${JSON.stringify(payload)}`;
      }

      // Set up timeout if constraints specify one
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (automation.constraints?.timeout_seconds) {
        timeoutId = setTimeout(
          () => controller.abort(),
          automation.constraints.timeout_seconds * 1000,
        );
      }

      try {
        const result = await runMessage(session, prompt, controller.signal, options.streamHooks);

        const automationResult: AutomationResult = {
          automation: automation.name,
          response: result.response,
          tool_calls: result.tool_calls,
          output_sent: false,
          duration_ms: Date.now() - startTime,
        };

        // Route output
        const outputSent = await routeOutput(automation.output, automationResult);
        automationResult.output_sent = outputSent;

        return automationResult;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Automation "${automation.name}" failed: ${message}`, 'automation');
      return {
        automation: automation.name,
        response: '',
        tool_calls: [],
        output_sent: false,
        duration_ms: Date.now() - startTime,
      };
    } finally {
      await options.sessionManager.destroy(session.id);
    }
  };
}
