/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Delivery Router.
 *
 * Dispatches automation results to configured targets (webhooks and/or
 * ISV callbacks). Also handles failure alerting with consecutive-failure
 * tracking and cooldown windows.
 *
 * Each automation's `delivery` config fires on successful completion.
 * Each automation's `failureAlert` config fires after N consecutive
 * failures, respecting a cooldown so sustained outages don't flood the
 * notification channel.
 */

import {createHmac} from 'node:crypto';
import type {
  DeliveryConfig,
  DeliveryPayload,
  DeliveryTarget,
  FailureAlertConfig,
} from '@amodalai/types';
import type {Logger} from '../../logger.js';

const DEFAULT_FAILURE_THRESHOLD = 1;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DELIVERY_TIMEOUT_MS = 10_000;

/** Invoked when a callback-type delivery target fires. */
export type AutomationResultCallback = (payload: DeliveryPayload) => void | Promise<void>;

export interface DeliveryRouterOptions {
  logger: Logger;
  /** Shared HMAC secret for webhook signing. Optional. */
  webhookSecret?: string;
  /** ISV callback invoked when a target of type 'callback' fires. */
  onResult?: AutomationResultCallback;
}

interface FailureState {
  consecutiveFailures: number;
  lastAlertAt: number | null;
}

export class DeliveryRouter {
  private readonly logger: Logger;
  private readonly webhookSecret: string | undefined;
  private readonly onResult: AutomationResultCallback | undefined;
  private readonly failureState = new Map<string, FailureState>();

  constructor(opts: DeliveryRouterOptions) {
    this.logger = opts.logger;
    this.webhookSecret = opts.webhookSecret;
    this.onResult = opts.onResult;
  }

  /**
   * Record a successful automation run and dispatch the configured
   * delivery (if any). Resets the failure counter for this automation.
   */
  async onSuccess(
    automationName: string,
    rawOutput: string,
    delivery: DeliveryConfig | undefined,
  ): Promise<void> {
    this.failureState.delete(automationName);

    if (!delivery) return;

    const parsed = tryParseJson(rawOutput);
    const includeResult = delivery.includeResult ?? true;

    const payload: DeliveryPayload = {
      automation: automationName,
      status: 'success',
      timestamp: new Date().toISOString(),
      ...(includeResult ? {result: rawOutput} : {}),
      ...(parsed ? {data: parsed} : {}),
      ...(delivery.template
        ? {message: renderTemplate(delivery.template, {
            automation: automationName,
            timestamp: new Date().toISOString(),
            result: rawOutput,
            ...(parsed ?? {}),
          })}
        : {}),
    };

    await this.dispatchTargets(delivery.targets, payload);
  }

  /**
   * Record a failed automation run. Increments the consecutive-failure
   * counter. If it meets the `after` threshold and no recent alert has
   * fired within the cooldown window, dispatches the failure alert.
   */
  async onFailure(
    automationName: string,
    error: string,
    failureAlert: FailureAlertConfig | undefined,
  ): Promise<void> {
    const state = this.failureState.get(automationName) ?? {consecutiveFailures: 0, lastAlertAt: null};
    state.consecutiveFailures += 1;
    this.failureState.set(automationName, state);

    if (!failureAlert) return;

    const threshold = failureAlert.after ?? DEFAULT_FAILURE_THRESHOLD;
    if (state.consecutiveFailures < threshold) return;

    const cooldownMs = (failureAlert.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60_000;
    const now = Date.now();
    if (state.lastAlertAt !== null && now - state.lastAlertAt < cooldownMs) {
      this.logger.debug('delivery_alert_cooldown_skip', {
        automation: automationName,
        consecutiveFailures: state.consecutiveFailures,
        msSinceLastAlert: now - state.lastAlertAt,
      });
      return;
    }

    state.lastAlertAt = now;

    const payload: DeliveryPayload = {
      automation: automationName,
      status: 'failure',
      timestamp: new Date().toISOString(),
      error,
    };

    await this.dispatchTargets(failureAlert.targets, payload);
  }

  /** For tests / observability. */
  getFailureCount(automationName: string): number {
    return this.failureState.get(automationName)?.consecutiveFailures ?? 0;
  }

  private async dispatchTargets(targets: DeliveryTarget[], payload: DeliveryPayload): Promise<void> {
    await Promise.all(targets.map((target) => this.dispatchTarget(target, payload)));
  }

  private async dispatchTarget(target: DeliveryTarget, payload: DeliveryPayload): Promise<void> {
    try {
      if (target.type === 'webhook') {
        await this.deliverWebhook(target.url, payload);
      } else if (target.type === 'callback') {
        if (!this.onResult) {
          this.logger.warn('delivery_callback_not_configured', {
            automation: payload.automation,
            hint: 'Pass onAutomationResult when creating the server to receive callback deliveries.',
          });
          return;
        }
        await this.onResult(payload);
      }
    } catch (err) {
      // Delivery failures must not break the automation run. Log and
      // continue — the automation result is already persisted to stores
      // and the audit log before delivery is attempted.
      this.logger.warn('delivery_failed', {
        automation: payload.automation,
        target: target.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async deliverWebhook(url: string, payload: DeliveryPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.webhookSecret) {
      const signature = createHmac('sha256', this.webhookSecret).update(body).digest('hex');
      headers['X-Amodal-Signature'] = `sha256=${signature}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`webhook ${url} returned ${String(response.status)}`);
    }
  }
}

/**
 * Try to parse the automation's raw output as JSON. If the output looks
 * like a fenced JSON code block, strip the fence first.
 */
function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]+?)\n```\s*$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  if (!candidate) return null;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- verified object shape
      return parsed as Record<string, unknown>;
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Simple {{variable}} substitution. Variables come from a flat record.
 * Missing variables are left as-is (they render as the literal token).
 * Values are coerced to string.
 */
function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return `{{${key}}}`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}
