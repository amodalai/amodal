/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { AmodalConfig } from './amodal-config.js';
import { KnowledgeStore } from './knowledge/knowledge-store.js';

describe('AmodalConfig', () => {
  it('should construct with minimal parameters', () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
    });

    expect(config.getSessionId()).toBe('test-session');
    expect(config.getPlatformApiUrl()).toBeUndefined();
    expect(config.getPlatformApiKey()).toBeUndefined();
    expect(config.getApplicationId()).toBeUndefined();
    expect(config.getTenantId()).toBeUndefined();
    expect(config.getAuditLogger()).toBeUndefined();
    expect(config.getConnections()).toEqual({});
    expect(config.getConnectionInfos()).toEqual([]);
    expect(config.getAgentContext()).toBeUndefined();
  });

  it('should expose extension fields via ToolContext interface', () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
      platformApiUrl: 'https://platform.test.com',
      platformApiKey: 'test-key',
      applicationId: 'app-1',
      tenantId: 'tenant-1',
      connections: { datadog: { API_KEY: 'abc' } },
      agentContext: 'Test agent context',
      connectionInfos: [{ name: 'datadog', provider: 'Datadog' }],
    });

    expect(config.getPlatformApiUrl()).toBe('https://platform.test.com');
    expect(config.getPlatformApiKey()).toBe('test-key');
    expect(config.getApplicationId()).toBe('app-1');
    expect(config.getTenantId()).toBe('tenant-1');
    expect(config.getConnections()).toEqual({ datadog: { API_KEY: 'abc' } });
    expect(config.getAgentContext()).toBe('Test agent context');
    expect(config.getConnectionInfos()).toHaveLength(1);
  });

  it('should create a KnowledgeStore from provided documents', () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
      appDocuments: [
        {
          id: 'doc-1',
          scope_type: 'application',
          scope_id: 'app-1',
          title: 'Test Doc',
          category: 'system_docs',
          body: 'Test body',
          tags: ['test'],
          status: 'active',
          source: 'admin',
          created_by: 'admin',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ],
    });

    const store = config.getKnowledgeStore();
    expect(store).toBeInstanceOf(KnowledgeStore);
    expect(store.getAllDocuments()).toHaveLength(1);
    expect(store.getAllDocuments()[0].title).toBe('Test Doc');
  });

  it('should provide access to upstream Config', () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
    });

    const upstreamConfig = config.getUpstreamConfig();
    expect(upstreamConfig).toBeDefined();
    expect(upstreamConfig.getSessionId()).toBe('test-session');
  });

  it('getSessionEnv returns _secrets from connections', () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
      connections: {
        test_api: { BASE_URL: 'https://api.example.com' },
        _secrets: { API_KEY: 'tenant-secret', BASE_URL: 'https://custom.api.com' },
      },
    });

    const env = config.getSessionEnv();
    expect(env).toEqual({ API_KEY: 'tenant-secret', BASE_URL: 'https://custom.api.com' });
  });

  it('getSessionEnv returns empty object when no secrets', () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
    });

    expect(config.getSessionEnv()).toEqual({});
  });

  it('shutdown calls upstream config.dispose()', async () => {
    const config = new AmodalConfig({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
    });

    const upstream = config.getUpstreamConfig();
    const disposeSpy = vi.spyOn(upstream, 'dispose').mockResolvedValue();

    await config.shutdown();

    expect(disposeSpy).toHaveBeenCalledOnce();
    disposeSpy.mockRestore();
  });
});
