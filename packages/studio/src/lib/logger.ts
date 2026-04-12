/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Logger for the studio-app.
 *
 * Follows the same Logger interface as @amodalai/core but is self-contained
 * to avoid a dependency on the core package (studio-app is standalone).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Logger {
  trace(event: string, data?: Record<string, unknown>): void;
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  NONE = 5,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.NONE]: '',
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseLogLevel(value: string | undefined): LogLevel {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- default handles undefined + unknown strings
  switch (value?.toLowerCase()) {
    case 'trace': return LogLevel.TRACE;
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    case 'none': return LogLevel.NONE;
    default: return LogLevel.INFO;
  }
}

const configuredLevel = parseLogLevel(process.env['LOG_LEVEL']);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{"_serializeError":"circular or non-serializable data"}';
  }
}

function createLoggerImpl(bindings: Record<string, unknown>): Logger {
  function emit(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    if (level < configuredLevel) return;

    const merged = { ...bindings, ...data };
    const label = LEVEL_LABELS[level];
    const hasExtra = Object.keys(merged).length > 0;

    const output = hasExtra
      ? `[${label}] [studio] ${event} ${safeStringify(merged)}\n`
      : `[${label}] [studio] ${event}\n`;

    process.stderr.write(output);
  }

  return {
    trace: (event, data) => emit(LogLevel.TRACE, event, data),
    debug: (event, data) => emit(LogLevel.DEBUG, event, data),
    info: (event, data) => emit(LogLevel.INFO, event, data),
    warn: (event, data) => emit(LogLevel.WARN, event, data),
    error: (event, data) => emit(LogLevel.ERROR, event, data),
    child(childBindings: Record<string, unknown>): Logger {
      return createLoggerImpl({ ...bindings, ...childBindings });
    },
  };
}

/** Root logger for the studio-app. */
export const logger: Logger = createLoggerImpl({});
