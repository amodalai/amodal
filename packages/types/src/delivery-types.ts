/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Delivery routing types for automation results.
 *
 * Automations can declare where their output should go when they
 * complete (or fail). Targets can be webhooks, ISV-provided callbacks,
 * or — in the future — email. Failure alerting tracks consecutive
 * failures per automation and sends notifications with a cooldown to
 * avoid spam.
 */

/** Destination for an automation result or failure alert. */
export type DeliveryTarget =
  | {
      type: 'webhook';
      /**
       * HTTP(S) URL to POST to. Must start with `http://` or `https://`.
       * Supports `env:NAME` substitution — resolved at bundle-load time.
       */
      url: string;
    }
  | {
      type: 'callback';
      /**
       * Optional tag identifying which callback invocation this is.
       * Passed to `onAutomationResult(payload, target)` so ISVs with
       * multiple callback targets can distinguish them.
       */
      name?: string;
    };

/** Configuration for where an automation's successful result goes. */
export interface DeliveryConfig {
  /** One or more destinations. */
  targets: DeliveryTarget[];
  /** Include the automation's raw response text in the payload. Default true. */
  includeResult?: boolean;
  /**
   * Optional message template. Variables come from the automation's
   * parsed result (if the last assistant message is JSON, from its
   * top-level keys) or from a small set of built-ins: `{{automation}}`,
   * `{{timestamp}}`, `{{result}}`.
   */
  template?: string;
}

/** Configuration for failure alerts. Fires after N consecutive failures. */
export interface FailureAlertConfig {
  /** How many consecutive failures before an alert fires. Default 1. */
  after?: number;
  /** Targets to notify on failure. */
  targets: DeliveryTarget[];
  /**
   * Minimum minutes between alerts for the same automation. Prevents
   * alert spam during sustained outages. Default 60.
   */
  cooldownMinutes?: number;
}

/**
 * Payload shape emitted to delivery targets.
 * Template-rendered `message` is only present if `template` was set.
 */
export interface DeliveryPayload {
  automation: string;
  status: 'success' | 'failure';
  timestamp: string;
  /** Raw text output from the automation run (truncated at 16KB). */
  result?: string;
  /**
   * True if `result` was truncated at the delivery payload size cap.
   * Full text remains in the automation session's message history.
   */
  truncated?: boolean;
  /** Rendered template, if a template was configured. */
  message?: string;
  /** Error message, only present when status === 'failure'. */
  error?: string;
  /**
   * Parsed JSON result, if the last assistant message was valid JSON.
   * Used for template variable substitution. Not truncated.
   */
  data?: Record<string, unknown>;
}
