/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  log,
  createLogger,
  setLogLevel,
  setLogFormat,
  setSanitize,
  LogLevel,
} from './logger.js';
import type { Logger } from './logger.js';

describe('Logger', () => {
  let stderrWrite: ReturnType<typeof vi.fn>;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalWrite = process.stderr.write;
    stderrWrite = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write;
    setLogLevel(LogLevel.TRACE);
    setLogFormat('text');
    setSanitize((data) => data);
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    setLogLevel(LogLevel.INFO);
    setLogFormat('text');
  });

  describe('backward compatibility', () => {
    it('accepts (message, tag) string arguments', () => {
      log.info('Server started', 'server');
      expect(stderrWrite).toHaveBeenCalledWith('[INFO] [server] Server started\n');
    });

    it('works with message only', () => {
      log.error('Something broke');
      expect(stderrWrite).toHaveBeenCalledWith('[ERROR] Something broke\n');
    });
  });

  describe('structured data', () => {
    it('includes data fields in text mode', () => {
      log.info('request_completed', { method: 'GET', status: 200 });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('[INFO] request_completed');
      expect(output).toContain('"method":"GET"');
      expect(output).toContain('"status":200');
    });

    it('includes tag and data fields together', () => {
      log.info('event', { tag: 'mytag', extra: 'val' });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('[mytag]');
      expect(output).toContain('"extra":"val"');
    });
  });

  describe('log levels', () => {
    it('respects log level filtering', () => {
      setLogLevel(LogLevel.WARN);
      log.debug('should not appear');
      log.info('should not appear');
      log.warn('should appear');
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      expect(stderrWrite).toHaveBeenCalledWith('[WARN] should appear\n');
    });

    it('NONE suppresses all output', () => {
      setLogLevel(LogLevel.NONE);
      log.fatal('should not appear');
      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });

  describe('child()', () => {
    it('creates a scoped logger with inherited bindings', () => {
      const sessionLog = log.child({ session: 'sess-123', tenant: 'acme' });
      sessionLog.info('message_received');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('message_received');
      expect(output).toContain('"session":"sess-123"');
      expect(output).toContain('"tenant":"acme"');
    });

    it('merges child data with call-site data', () => {
      const sessionLog = log.child({ session: 'sess-123' });
      sessionLog.info('tool_call', { tool: 'search', duration: 42 });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"session":"sess-123"');
      expect(output).toContain('"tool":"search"');
      expect(output).toContain('"duration":42');
    });

    it('call-site data overrides child bindings', () => {
      const sessionLog = log.child({ status: 'pending' });
      sessionLog.info('updated', { status: 'done' });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"status":"done"');
      expect(output).not.toContain('"status":"pending"');
    });

    it('supports nested children', () => {
      const sessionLog = log.child({ session: 'sess-1' });
      const toolLog = sessionLog.child({ tool: 'search' });
      toolLog.info('executing');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"session":"sess-1"');
      expect(output).toContain('"tool":"search"');
    });

    it('accepts traceId for distributed tracing', () => {
      const sessionLog = log.child({ session: 'sess-1', traceId: 'abc-def-123' });
      sessionLog.info('traced_event');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"traceId":"abc-def-123"');
    });
  });

  describe('JSON format', () => {
    it('outputs valid JSON lines', () => {
      setLogFormat('json');
      log.info('server_started', { port: 3000 });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed['level']).toBe('info');
      expect(parsed['event']).toBe('server_started');
      expect(parsed['port']).toBe(3000);
      expect(parsed['ts']).toBeDefined();
    });

    it('includes timestamp as ISO string', () => {
      setLogFormat('json');
      log.info('test');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(() => new Date(parsed['ts'] as string)).not.toThrow();
    });

    it('includes child bindings in JSON output', () => {
      setLogFormat('json');
      const sessionLog = log.child({ session: 'sess-42', tenant: 'acme' });
      sessionLog.warn('rate_limited', { provider: 'anthropic' });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed['level']).toBe('warn');
      expect(parsed['session']).toBe('sess-42');
      expect(parsed['tenant']).toBe('acme');
      expect(parsed['provider']).toBe('anthropic');
    });

    it('handles backward-compat tag in JSON', () => {
      setLogFormat('json');
      log.info('event', 'mytag');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed['tag']).toBe('mytag');
      expect(parsed['event']).toBe('event');
    });
  });

  describe('sanitize hook', () => {
    it('sanitizes data before output', () => {
      setSanitize((data) => {
        const sanitized = { ...data };
        if ('apiKey' in sanitized) {
          sanitized['apiKey'] = '***';
        }
        return sanitized;
      });
      log.info('provider_init', { provider: 'anthropic', apiKey: 'sk-secret-123' });
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"apiKey":"***"');
      expect(output).not.toContain('sk-secret-123');
    });

    it('sanitizes child bindings too', () => {
      setSanitize((data) => {
        const sanitized = { ...data };
        if (typeof sanitized['email'] === 'string') {
          sanitized['email'] = 'user_***@***.com';
        }
        return sanitized;
      });
      const userLog = log.child({ email: 'bob@example.com' });
      userLog.info('user_action');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('user_***@***.com');
      expect(output).not.toContain('bob@example.com');
    });
  });

  describe('createLogger', () => {
    it('creates an independent logger with bindings', () => {
      const logger: Logger = createLogger({ service: 'scheduler' });
      logger.info('tick');
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('"service":"scheduler"');
    });
  });

  describe('circular reference safety', () => {
    it('does not throw on circular data in text mode', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular['self'] = circular;
      expect(() => log.info('circular_test', circular)).not.toThrow();
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('_serializeError');
    });

    it('does not throw on circular data in JSON mode', () => {
      setLogFormat('json');
      const circular: Record<string, unknown> = { b: 2 };
      circular['self'] = circular;
      expect(() => log.warn('circular_json', circular)).not.toThrow();
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const output = stderrWrite.mock.calls[0]?.[0] as string;
      expect(output).toContain('_serializeError');
    });
  });
});
