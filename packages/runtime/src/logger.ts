/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Structured logger for the Amodal runtime.
 *
 * Log level is controlled by the `LOG_LEVEL` environment variable.
 * Valid values (case-insensitive): trace, debug, info, warn, error, fatal, none.
 * Default: "info".
 *
 * Log format is controlled by the `LOG_FORMAT` environment variable.
 * Valid values: "text" (default), "json" (JSON lines for log aggregation).
 *
 * Usage:
 *   import { log } from './logger.js';
 *   log.info('server_started', { port: 3000 });
 *   log.info('Server started', 'server');   // backward-compat: tag as string
 *
 * Scoped loggers via child():
 *   const sessionLog = log.child({ session: sessionId, tenant: tenantId });
 *   sessionLog.info('message_received');  // automatically includes session + tenant
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

export type LogFormat = 'text' | 'json';

export interface LoggerConfig {
  level: LogLevel;
  format: LogFormat;
  sanitize?: (data: Record<string, unknown>) => Record<string, unknown>;
}

export interface Logger {
  trace(event: string, data?: Record<string, unknown> | string): void;
  debug(event: string, data?: Record<string, unknown> | string): void;
  info(event: string, data?: Record<string, unknown> | string): void;
  warn(event: string, data?: Record<string, unknown> | string): void;
  error(event: string, data?: Record<string, unknown> | string): void;
  fatal(event: string, data?: Record<string, unknown> | string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function parseLogLevel(value: string | undefined): LogLevel {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- default handles undefined + unknown strings
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

function parseLogFormat(value: string | undefined): LogFormat {
  if (value?.toLowerCase() === 'json') return 'json';
  return 'text';
}

const defaultSanitize = (data: Record<string, unknown>): Record<string, unknown> => data;

let config: LoggerConfig = {
  level: parseLogLevel(process.env['LOG_LEVEL']),
  format: parseLogFormat(process.env['LOG_FORMAT']),
  sanitize: defaultSanitize,
};

/** Update the runtime log level programmatically. */
export function setLogLevel(level: LogLevel): void {
  config = { ...config, level };
}

/** Get the current log level. */
export function getLogLevel(): LogLevel {
  return config.level;
}

/** Update the log format programmatically. */
export function setLogFormat(format: LogFormat): void {
  config = { ...config, format };
}

/** Get the current log format. */
export function getLogFormat(): LogFormat {
  return config.format;
}

/** Set the sanitize function for PII redaction. */
export function setSanitize(fn: (data: Record<string, unknown>) => Record<string, unknown>): void {
  config = { ...config, sanitize: fn };
}

function normalizeData(data: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (data === undefined) return {};
  if (typeof data === 'string') return { tag: data };
  return data;
}

function formatText(
  level: LogLevel,
  event: string,
  merged: Record<string, unknown>,
): string {
  const label = LEVEL_LABELS[level];
  const tag = merged['tag'];
  const prefix = tag ? `[${label}] [${String(tag)}] ` : `[${label}] `;

  // Include non-tag data fields in text mode
  const extra: Record<string, unknown> = {};
  let hasExtra = false;
  for (const [k, v] of Object.entries(merged)) {
    if (k !== 'tag') {
      extra[k] = v;
      hasExtra = true;
    }
  }

  if (hasExtra) {
    return `${prefix}${event} ${JSON.stringify(extra)}\n`;
  }
  return `${prefix}${event}\n`;
}

function formatJson(
  level: LogLevel,
  event: string,
  merged: Record<string, unknown>,
): string {
  const entry: Record<string, unknown> = {
    level: LEVEL_LABELS[level].toLowerCase(),
    ts: new Date().toISOString(),
    event,
    ...merged,
  };
  return JSON.stringify(entry) + '\n';
}

function createLoggerImpl(bindings: Record<string, unknown>): Logger {
  function emit(level: LogLevel, event: string, data?: Record<string, unknown> | string): void {
    if (level < config.level) return;

    const normalized = normalizeData(data);
    const merged = { ...bindings, ...normalized };
    const sanitized = (config.sanitize ?? defaultSanitize)(merged);

    const output = config.format === 'json'
      ? formatJson(level, event, sanitized)
      : formatText(level, event, sanitized);

    process.stderr.write(output);
  }

  return {
    trace: (event, data) => emit(LogLevel.TRACE, event, data),
    debug: (event, data) => emit(LogLevel.DEBUG, event, data),
    info: (event, data) => emit(LogLevel.INFO, event, data),
    warn: (event, data) => emit(LogLevel.WARN, event, data),
    error: (event, data) => emit(LogLevel.ERROR, event, data),
    fatal: (event, data) => emit(LogLevel.FATAL, event, data),
    child(childBindings: Record<string, unknown>): Logger {
      return createLoggerImpl({ ...bindings, ...childBindings });
    },
  };
}

/** Create a new logger with the given bindings. */
export function createLogger(bindings?: Record<string, unknown>): Logger {
  return createLoggerImpl(bindings ?? {});
}

/** Root logger instance. Backward-compatible with the old `log.*` API. */
export const log: Logger = createLoggerImpl({});

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
    if (config.level <= LogLevel.TRACE) {
      origLog.apply(console, args);
    }
  };

  console.debug = (...args: unknown[]) => {
    if (config.level <= LogLevel.TRACE) {
      origDebug.apply(console, args);
    }
  };

  console.warn = (...args: unknown[]) => {
    if (config.level <= LogLevel.DEBUG) {
      origWarn.apply(console, args);
    }
  };

  console.error = (...args: unknown[]) => {
    if (config.level <= LogLevel.WARN) {
      // Suppress known noisy upstream messages
      if (typeof args[0] === 'string' && args[0].includes('Current logger will')) return;
      origError.apply(console, args);
    }
  };
}
/* eslint-enable no-console */
