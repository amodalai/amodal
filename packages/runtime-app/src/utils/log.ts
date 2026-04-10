/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tiny browser-side logger.
 *
 * The runtime-app is a browser SPA — there's no Node logger. This wraps
 * `console.warn`/`console.error` with a component prefix so logs are
 * attributable, and centralizes the eslint-disable for `no-console`.
 *
 * Use this instead of calling console directly so we have one place to
 * change logging behavior (e.g., route to a remote sink in cloud mode).
 */

/* eslint-disable no-console -- this module is the centralized log sink */

export interface BrowserLogger {
  warn(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
}

/**
 * Create a logger scoped to a component or module name.
 * The name is included in every log line for easy filtering in the browser console.
 */
export function createLogger(name: string): BrowserLogger {
  const prefix = `[${name}]`;
  return {
    warn(event, context) {
      if (context !== undefined) {
        console.warn(prefix, event, context);
      } else {
        console.warn(prefix, event);
      }
    },
    error(event, context) {
      if (context !== undefined) {
        console.error(prefix, event, context);
      } else {
        console.error(prefix, event);
      }
    },
  };
}
