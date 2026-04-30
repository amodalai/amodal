/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Connection-validation probe result types (Phase A).
 *
 * A connection package ships a `validate.ts` module exporting one or
 * more named async probe functions. The runtime's `validate_connection`
 * custom tool dynamically imports the module, runs the named probe,
 * and returns a `ValidationResult` to the LLM.
 *
 * The probe contract:
 *
 *   // node_modules/@amodalai/connection-slack/validate.ts
 *   export async function list_channels(): Promise<ProbeResult> { ... }
 *
 * Probes return a `ProbeResult` — either `{ok: true, ...payload}` with
 * primitive fields the chat surface can render, or `{ok: false, reason}`
 * for soft failures (`auth_failed`, `no_data`, `error`). The probe
 * makes its own HTTP calls using env vars set during Connect; it does
 * NOT receive credentials as arguments.
 *
 * Probes return primitives + arrays of primitives only. Nested objects
 * are scrubbed by `validate_connection` before the result reaches the
 * LLM — never echo tokens, PII, or arbitrary API responses.
 */

/** Reason codes for soft-fail probe results. */
export type ProbeFailureReason = 'auth_failed' | 'no_data' | 'error';

/**
 * The shape a probe function returns. Either a success object with
 * additional primitive fields the caller may extract via `extractPath`,
 * or a typed failure object.
 *
 * Success payload: any primitive field (string/number/boolean) or
 * array of primitives. Nested objects are stripped.
 */
export type ProbeResult =
  | (
      {
        ok: true;
      } & Record<string, string | number | boolean | Array<string | number | boolean> | null>
    )
  | {
      ok: false;
      reason: ProbeFailureReason;
      message?: string;
    };

/**
 * Format helpers `validate_connection` applies to the extracted value
 * before returning the human-facing string.
 *
 * - `count` — formats numbers as compact ("8.2k", "1.5M", "12").
 * - `currency` — formats numbers with locale-aware currency syntax.
 * - `name` — passes a string through after PII scrubbing.
 * - `raw` — returns the value as-is (`String(value)`).
 */
export type ValidationFormat = 'count' | 'currency' | 'name' | 'raw';

/**
 * Result `validate_connection` returns to the LLM after running a
 * probe. On success, `value` is the extracted primitive and `formatted`
 * is the human-rendered string the prompt copies into chat. On failure,
 * `reason` is the probe's soft-fail code and `message` is an optional
 * one-line explanation.
 */
export type ValidationResult =
  | {
      ok: true;
      /** Primitive extracted from the probe payload (via `extractPath`). */
      value: string | number | boolean;
      /** Human-rendered string the chat surface displays inline. */
      formatted: string;
    }
  | {
      ok: false;
      reason: ProbeFailureReason;
      message?: string;
    };
