/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Structured logger for Amodal.
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
 *   log.info('build_started', { repo: '/path/to/agent' });
 *   log.info('Build started', 'build');   // backward-compat: tag as string
 *
 * Scoped loggers via child():
 *   const buildLog = log.child({ repo: repoPath });
 *   buildLog.info('snapshot_built');  // automatically includes repo
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{"_serializeError":"circular or non-serializable data"}';
  }
}

function formatText(
  level: LogLevel,
  event: string,
  merged: Record<string, unknown>,
): string {
  const label = LEVEL_LABELS[level];
  const tag = merged['tag'];
  const prefix = tag ? `[${label}] [${String(tag)}] ` : `[${label}] `;

  const extra: Record<string, unknown> = {};
  let hasExtra = false;
  for (const [k, v] of Object.entries(merged)) {
    if (k !== 'tag') {
      extra[k] = v;
      hasExtra = true;
    }
  }

  if (hasExtra) {
    return `${prefix}${event} ${safeStringify(extra)}\n`;
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
  return safeStringify(entry) + '\n';
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
