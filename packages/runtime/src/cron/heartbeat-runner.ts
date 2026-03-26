/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AutomationDefinition } from '@amodalai/core';
import type { AutomationResult } from '../types.js';
import type { SessionManager } from '../session/session-manager.js';
import { runMessage, type StreamAuditContext } from '../session/session-runner.js';
import { routeOutput } from '../output/output-router.js';
import type { AuditClient } from '../audit/audit-client.js';

export type AutomationRunnerFn = (
  automation: AutomationDefinition,
  payload?: Record<string, unknown>,
) => Promise<AutomationResult>;

export interface AutomationRunnerOptions {
  sessionManager: SessionManager;
  auditClient?: AuditClient;
  /** App ID for audit logging (e.g. from platform config) */
  auditAppId?: string;
  /** Auth token for audit logging */
  auditToken?: string;
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
      process.stderr.write(
        `[ERROR] Automation "${automation.name}" failed to create session: ${message}\n`,
      );
      return {
        automation: automation.name,
        response: '',
        tool_calls: [],
        output_sent: false,
        duration_ms: Date.now() - startTime,
      };
    }

    // Build audit context if audit client is available
    let audit: StreamAuditContext | undefined;
    if (options.auditClient && options.auditAppId && options.auditToken) {
      audit = {
        auditClient: options.auditClient,
        appId: options.auditAppId,
        token: options.auditToken,
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
        const result = await runMessage(session, prompt, controller.signal, audit);

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
      process.stderr.write(
        `[ERROR] Automation "${automation.name}" failed: ${message}\n`,
      );
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
