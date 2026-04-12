/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tiny browser-side logger for Studio client components.
 *
 * Wraps `console.warn`/`console.error` with a component prefix so logs are
 * attributable. Use this instead of calling console directly.
 */

/* eslint-disable no-console -- this module is the centralized browser log sink */

export interface BrowserLogger {
  warn(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
}

/**
 * Create a logger scoped to a component or module name.
 */
export function createBrowserLogger(name: string): BrowserLogger {
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
