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
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  NONE = 5,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
  [LogLevel.NONE]: '',
};

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
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
  debug: (message: string, tag?: string): void => write(LogLevel.DEBUG, message, tag),
  info: (message: string, tag?: string): void => write(LogLevel.INFO, message, tag),
  warn: (message: string, tag?: string): void => write(LogLevel.WARN, message, tag),
  error: (message: string, tag?: string): void => write(LogLevel.ERROR, message, tag),
  fatal: (message: string, tag?: string): void => write(LogLevel.FATAL, message, tag),
};
