/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Lightweight structured logger for the runtime.
 *
 * Log level is controlled by the `LOG_LEVEL` environment variable.
 * Valid values (case-insensitive): debug, info, warn, error, fatal, none.
 * Default: "info".
 *
 * Usage:
 *   import { log } from './logger.js';
 *   log.info('Server started', 'server');   // [INFO] [server] Server started
 *   log.debug('Details here', 'session');    // only printed when LOG_LEVEL=debug
 *   log.error('Something broke');            // [ERROR] Something broke
 */

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
  NONE = 6,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
  [LogLevel.NONE]: '',
};

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
    case 'trace':
      return LogLevel.TRACE;
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    case 'fatal':
      return LogLevel.FATAL;
    case 'none':
      return LogLevel.NONE;
    default:
      return LogLevel.INFO;
  }
}

let currentLevel: LogLevel = parseLogLevel(process.env['LOG_LEVEL']);

/** Update the runtime log level programmatically. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Get the current log level. */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

function write(level: LogLevel, message: string, tag?: string): void {
  if (level < currentLevel) return;
  const label = LEVEL_LABELS[level];
  const prefix = tag ? `[${label}] [${tag}] ` : `[${label}] `;
  process.stderr.write(`${prefix}${message}\n`);
}

export const log = {
  trace: (message: string, tag?: string): void => write(LogLevel.TRACE, message, tag),
  debug: (message: string, tag?: string): void => write(LogLevel.DEBUG, message, tag),
  info: (message: string, tag?: string): void => write(LogLevel.INFO, message, tag),
  warn: (message: string, tag?: string): void => write(LogLevel.WARN, message, tag),
  error: (message: string, tag?: string): void => write(LogLevel.ERROR, message, tag),
  fatal: (message: string, tag?: string): void => write(LogLevel.FATAL, message, tag),
};

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
    // Env var already handled by the module-level initializer
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
    if (currentLevel <= LogLevel.TRACE) {
      origLog.apply(console, args);
    }
  };

  console.debug = (...args: unknown[]) => {
    if (currentLevel <= LogLevel.TRACE) {
      origDebug.apply(console, args);
    }
  };

  console.warn = (...args: unknown[]) => {
    if (currentLevel <= LogLevel.DEBUG) {
      origWarn.apply(console, args);
    }
  };

  console.error = (...args: unknown[]) => {
    if (currentLevel <= LogLevel.WARN) {
      // Suppress known noisy upstream messages
      if (typeof args[0] === 'string' && args[0].includes('Current logger will')) return;
      origError.apply(console, args);
    }
  };
}
/* eslint-enable no-console */
