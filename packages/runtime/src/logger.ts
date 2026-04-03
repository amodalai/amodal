/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Runtime logger — wraps the core logger and adds runtime-specific
 * utilities (CLI flag parsing, console interception).
 *
 * The Logger interface and core implementation live in @amodalai/core.
 * This module re-exports them and adds runtime-only functions.
 */

import {
  log as coreLog,
  createLogger as coreCreateLogger,
  setLogLevel as coreSetLogLevel,
  getLogLevel as coreGetLogLevel,
  setLogFormat as coreSetLogFormat,
  getLogFormat as coreGetLogFormat,
  setSanitize as coreSetSanitize,
  LogLevel,
} from '@amodalai/core';

import type { Logger, LoggerConfig, LogFormat } from '@amodalai/core';

// Re-export core logger API
export { LogLevel };
export type { Logger, LoggerConfig, LogFormat };

export const log: Logger = coreLog;
export const createLogger = coreCreateLogger;
export const setLogLevel = coreSetLogLevel;
export const getLogLevel = coreGetLogLevel;
export const setLogFormat = coreSetLogFormat;
export const getLogFormat = coreGetLogFormat;
export const setSanitize = coreSetSanitize;

/**
 * Convert -v count and --quiet flag to a LogLevel.
 * --quiet → ERROR, default → INFO, -v → DEBUG, -vv → TRACE
 */
export function verbosityToLogLevel(verbosity: number, quiet: boolean): LogLevel {
  if (quiet) return LogLevel.ERROR;
  if (verbosity >= 2) return LogLevel.TRACE;
  if (verbosity >= 1) return LogLevel.DEBUG;
  return LogLevel.INFO;
}

/**
 * Initialize logger from CLI flags. Env var LOG_LEVEL takes precedence.
 * Call once at startup before any logging.
 */
export function initLogLevel(opts: {verbosity?: number; quiet?: boolean}): void {
  if (process.env['LOG_LEVEL']) {
    // Env var already handled by the module-level initializer in core
    return;
  }
  setLogLevel(verbosityToLogLevel(opts.verbosity ?? 0, opts.quiet ?? false));
}

/**
 * Intercept console.* to route upstream library output (e.g. @google/gemini-cli-core)
 * through our log levels. Call once at startup.
 */
/* eslint-disable no-console */
export function interceptConsole(): void {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origDebug = console.debug;

  console.log = (...args: unknown[]) => {
    if (getLogLevel() <= LogLevel.TRACE) {
      origLog.apply(console, args);
    }
  };

  console.debug = (...args: unknown[]) => {
    if (getLogLevel() <= LogLevel.TRACE) {
      origDebug.apply(console, args);
    }
  };

  console.warn = (...args: unknown[]) => {
    if (getLogLevel() <= LogLevel.DEBUG) {
      origWarn.apply(console, args);
    }
  };

  console.error = (...args: unknown[]) => {
    if (getLogLevel() <= LogLevel.WARN) {
      // Suppress known noisy upstream messages
      if (typeof args[0] === 'string' && args[0].includes('Current logger will')) return;
      origError.apply(console, args);
    }
  };
}
/* eslint-enable no-console */
