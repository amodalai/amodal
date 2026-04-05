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
 *
 * **State is in-memory.** `consecutiveFailures` counters and `lastAlertAt`
 * timestamps live on the DeliveryRouter instance. Process restart wipes
 * them: a flapping service mid-cooldown gets re-alerted on restart, and
 * a service failing for hours resets to 0 and needs `after` more failures
 * before the next alert. For hosted runtimes that restart periodically,
 * expect occasional alert repetition around deploy boundaries.
 */

import {createHmac} from 'node:crypto';
import type {
  DeliveryConfig,
  DeliveryPayload,
  DeliveryTarget,
  FailureAlertConfig,
  RuntimeEventPayload,
} from '@amodalai/types';
import type {Logger} from '../../logger.js';

const DEFAULT_FAILURE_THRESHOLD = 1;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DELIVERY_TIMEOUT_MS = 10_000;
const DELIVERY_RETRY_DELAY_MS = 1_000;
/** Max characters kept in `result` field of delivery payload. */
const MAX_RESULT_CHARS = 16_384;

/**
 * Invoked when a callback-type delivery target fires. The second argument
 * carries target metadata (currently just `name`) so ISVs with multiple
 * callback targets can distinguish which one is firing.
 */
export type AutomationResultCallback = (
  payload: DeliveryPayload,
  target: {name?: string},
) => void | Promise<void>;

interface DeliveryEventBus {
  emit: (payload: RuntimeEventPayload) => unknown;
}

export interface DeliveryRouterOptions {
  logger: Logger;
  /** Shared HMAC secret for webhook signing. Optional. */
  webhookSecret?: string;
  /** ISV callback invoked when a target of type 'callback' fires. */
  onResult?: AutomationResultCallback;
  /** Optional event bus for emitting delivery_succeeded / delivery_failed events. */
  eventBus?: DeliveryEventBus;
}

interface FailureState {
  consecutiveFailures: number;
  lastAlertAt: number | null;
}

export class DeliveryRouter {
  private readonly logger: Logger;
  private readonly webhookSecret: string | undefined;
  private readonly onResult: AutomationResultCallback | undefined;
  private readonly eventBus: DeliveryEventBus | undefined;
  private readonly failureState = new Map<string, FailureState>();
  /** Templates we've already warned about (one log per template + missing-key combo). */
  private readonly missingVarWarnings = new Set<string>();

  constructor(opts: DeliveryRouterOptions) {
    this.logger = opts.logger;
    this.webhookSecret = opts.webhookSecret;
    this.onResult = opts.onResult;
    this.eventBus = opts.eventBus;
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
    const {text: truncatedResult, truncated} = truncateResult(rawOutput);

    const payload: DeliveryPayload = {
      automation: automationName,
      status: 'success',
      timestamp: new Date().toISOString(),
      ...(includeResult ? {result: truncatedResult} : {}),
      ...(includeResult && truncated ? {truncated: true} : {}),
      ...(parsed ? {data: parsed} : {}),
      ...(delivery.template
        ? {message: this.renderTemplateWithWarnings(delivery.template, {
            automation: automationName,
            timestamp: new Date().toISOString(),
            result: rawOutput,
            ...(parsed ?? {}),
          }, automationName)}
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
    const startedAt = Date.now();
    try {
      switch (target.type) {
        case 'webhook': {
          const httpStatus = await this.deliverWebhookWithRetry(target.url, payload);
          this.emitDeliverySucceeded(payload.automation, 'webhook', target.url, httpStatus, Date.now() - startedAt);
          break;
        }
        case 'callback': {
          if (!this.onResult) {
            this.logger.warn('delivery_callback_not_configured', {
              automation: payload.automation,
              hint: 'Pass onAutomationResult when creating the server to receive callback deliveries.',
            });
            return;
          }
          await this.onResult(payload, {name: target.name});
          this.emitDeliverySucceeded(payload.automation, 'callback', undefined, undefined, Date.now() - startedAt);
          break;
        }
        default: {
          // Exhaustiveness guard: adding a new DeliveryTarget variant
          // (e.g., 'email') will fail to compile here until a case is
          // added, preventing silent "nothing delivered" regressions.
          const _exhaustive: never = target;
          throw new Error(`Unhandled delivery target: ${String((_exhaustive as {type: string}).type)}`);
        }
      }
    } catch (err) {
      // Delivery failures must not break the automation run. The
      // automation's output text lives on the runner's runHistory entry
      // and on session messages (via onSessionComplete); delivery
      // correctness is decoupled from automation correctness.
      const errorMessage = err instanceof Error ? err.message : String(err);
      const targetUrl = target.type === 'webhook' ? target.url : undefined;
      const httpStatus = err instanceof WebhookFailure ? err.httpStatus : undefined;
      const attempts = err instanceof WebhookFailure ? err.attempts : 1;

      this.logger.warn('delivery_failed', {
        automation: payload.automation,
        target: target.type,
        targetUrl,
        httpStatus,
        attempts,
        error: errorMessage,
      });

      this.eventBus?.emit({
        type: 'delivery_failed',
        automation: payload.automation,
        targetType: target.type,
        targetUrl,
        httpStatus,
        error: errorMessage,
        attempts,
      });
    }
  }

  private emitDeliverySucceeded(
    automation: string,
    targetType: string,
    targetUrl: string | undefined,
    httpStatus: number | undefined,
    durationMs: number,
  ): void {
    this.eventBus?.emit({
      type: 'delivery_succeeded',
      automation,
      targetType,
      targetUrl,
      httpStatus,
      durationMs,
    });
  }

  /**
   * Deliver with one retry on 5xx / network errors. 4xx errors are not
   * retried — they're client-side config bugs that won't fix themselves.
   * Throws a `WebhookFailure` carrying the final status + attempt count.
   */
  private async deliverWebhookWithRetry(url: string, payload: DeliveryPayload): Promise<number> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await this.deliverWebhook(url, payload);
      } catch (err) {
        const isRetryable = isRetryableError(err);
        if (attempt >= 2 || !isRetryable) {
          throw new WebhookFailure(
            err instanceof Error ? err.message : String(err),
            attempt,
            err instanceof WebhookHttpError ? err.status : undefined,
          );
        }
        this.logger.debug('delivery_retry', {
          url,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(DELIVERY_RETRY_DELAY_MS);
      }
    }
    // Unreachable — loop either returns or throws.
    throw new WebhookFailure('unreachable', 2);
  }

  private async deliverWebhook(url: string, payload: DeliveryPayload): Promise<number> {
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
      throw new WebhookHttpError(url, response.status);
    }
    return response.status;
  }

  /**
   * Render a template, warning once per (automation, template, missing-keys)
   * combo. Helps diagnose agent-output drift (e.g. agent stopped producing
   * `{{count}}` in its JSON output and now every alert reads
   * "Found {{count}} new articles").
   */
  private renderTemplateWithWarnings(
    template: string,
    vars: Record<string, unknown>,
    automationName: string,
  ): string {
    const missing = new Set<string>();
    const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined || value === null) {
        missing.add(key);
        return `{{${key}}}`;
      }
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });

    if (missing.size > 0) {
      const memoKey = `${automationName}\u0000${template}\u0000${[...missing].sort().join(',')}`;
      if (!this.missingVarWarnings.has(memoKey)) {
        this.missingVarWarnings.add(memoKey);
        this.logger.warn('delivery_template_missing_var', {
          automation: automationName,
          missing: [...missing],
          hint: 'Agent output may have drifted — verify the agent is producing these fields in its JSON result.',
        });
      }
    }

    return rendered;
  }
}

class WebhookHttpError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`webhook ${url} returned ${String(status)}`);
    this.name = 'WebhookHttpError';
    this.url = url;
    this.status = status;
  }
}

/** Error carrying the outcome of a webhook delivery attempt chain. */
class WebhookFailure extends Error {
  readonly attempts: number;
  readonly httpStatus?: number;

  constructor(message: string, attempts: number, httpStatus?: number) {
    super(message);
    this.name = 'WebhookFailure';
    this.attempts = attempts;
    this.httpStatus = httpStatus;
  }
}

/** Retryable: 5xx server errors, network errors, timeouts. Not: 4xx. */
function isRetryableError(err: unknown): boolean {
  if (err instanceof WebhookHttpError) {
    return err.status >= 500;
  }
  // Network errors, aborts, DNS failures, TypeError from fetch, etc.
  return err instanceof Error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate the raw output at MAX_RESULT_CHARS, keeping a head + tail
 * slice around an elision marker. Slack caps messages at ~4KB, GitHub
 * at ~64KB, most receivers somewhere in between — 16KB is a reasonable
 * ceiling that preserves most automation outputs intact.
 */
function truncateResult(text: string): {text: string; truncated: boolean} {
  if (text.length <= MAX_RESULT_CHARS) return {text, truncated: false};
  const keepChars = MAX_RESULT_CHARS - 100;
  const headChars = Math.floor(keepChars * 0.75);
  const tailChars = keepChars - headChars;
  const elision = `\n\n… [truncated ${String(text.length - keepChars)} chars] …\n\n`;
  return {
    text: text.slice(0, headChars) + elision + text.slice(-tailChars),
    truncated: true,
  };
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
