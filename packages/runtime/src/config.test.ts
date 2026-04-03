/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';
import { ConfigError } from './errors.js';

function makeTempRepo(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'amodal-config-test-'));
  writeFileSync(join(dir, 'amodal.json'), JSON.stringify(config));
  return dir;
}

const VALID_CONFIG = {
  name: 'test-agent',
  version: '1.0.0',
  description: 'A test agent',
  userContext: 'Always be helpful.',
  models: {
    main: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
};

describe('loadConfig', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
      LOG_LEVEL: process.env['LOG_LEVEL'],
    };
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('loads a valid config from amodal.json', () => {
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.name).toBe('test-agent');
      expect(config.version).toBe('1.0.0');
      expect(config.description).toBe('A test agent');
      expect(config.userContext).toBe('Always be helpful.');
      expect(config.primaryModel.provider).toBe('anthropic');
      expect(config.primaryModel.model).toBe('claude-sonnet-4-6');
      expect(config.repoPath).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('loads from .amodal/config.json if amodal.json missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amodal-config-test-'));
    mkdirSync(join(dir, '.amodal'));
    writeFileSync(join(dir, '.amodal', 'config.json'), JSON.stringify(VALID_CONFIG));
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.name).toBe('test-agent');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('throws ConfigError when no config file found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amodal-config-test-'));
    try {
      expect(() => loadConfig({ repoPath: dir })).toThrow(ConfigError);
      try {
        loadConfig({ repoPath: dir });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const ce = err as ConfigError;
        expect(ce.key).toBe('amodal.json');
        expect(ce.suggestion).toContain('amodal init');
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('throws ConfigError when provider API key is missing', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      expect(() => loadConfig({ repoPath: dir })).toThrow(ConfigError);
      try {
        loadConfig({ repoPath: dir });
      } catch (err) {
        const ce = err as ConfigError;
        expect(ce.suggestion).toContain('ANTHROPIC_API_KEY');
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('skips provider key check when credentials are explicit', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const dir = makeTempRepo({
      ...VALID_CONFIG,
      models: {
        main: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          credentials: { ANTHROPIC_API_KEY: 'inline-key' },
        },
      },
    });
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.primaryModel.credentials).toEqual({ ANTHROPIC_API_KEY: 'inline-key' });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('applies runtime overrides', () => {
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      const config = loadConfig({
        repoPath: dir,
        overrides: {
          primaryModel: { model: 'claude-opus-4-6' },
          storeBackend: 'postgres',
          postgresUrl: 'postgresql://localhost/test',
        },
      });
      expect(config.primaryModel.model).toBe('claude-opus-4-6');
      expect(config.primaryModel.provider).toBe('anthropic'); // preserved from base
      expect(config.stores.backend).toBe('postgres');
      expect(config.stores.postgresUrl).toBe('postgresql://localhost/test');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('sets default store config', () => {
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.stores.backend).toBe('pglite');
      expect(config.stores.dataDir).toBe(join(dir, '.amodal', 'store-data'));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('sets default sandbox config', () => {
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.sandbox.shellExec).toBe(false);
      expect(config.sandbox.maxTimeout).toBe(30000);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('parses MCP server configs', () => {
    const dir = makeTempRepo({
      ...VALID_CONFIG,
      mcp: {
        servers: {
          'my-server': {
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
          },
        },
      },
    });
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.mcpServers['my-server']).toEqual({
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('exposes raw config for backwards compatibility', () => {
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.raw.name).toBe('test-agent');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('respects LOG_LEVEL env var', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const dir = makeTempRepo(VALID_CONFIG);
    try {
      const config = loadConfig({ repoPath: dir });
      expect(config.logLevel).toBe(1); // LogLevel.DEBUG
    } finally {
      delete process.env['LOG_LEVEL'];
      rmSync(dir, { recursive: true });
    }
  });

  it('throws on invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amodal-config-test-'));
    writeFileSync(join(dir, 'amodal.json'), 'not json{{{');
    try {
      expect(() => loadConfig({ repoPath: dir })).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('throws on missing required fields', () => {
    const dir = makeTempRepo({ name: 'test' }); // missing version, models
    try {
      expect(() => loadConfig({ repoPath: dir })).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
