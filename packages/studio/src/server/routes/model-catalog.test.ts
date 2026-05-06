/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Hono} from 'hono';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {StudioBackend} from '../../lib/backend.js';
import type {DraftFile, PublishResult, WorkspaceBundle} from '../../lib/types.js';

const {runtimeConfig, backend} = vi.hoisted(() => {
  const drafts = new Map<string, string>();
  let workspaceContent = JSON.stringify({
    name: 'test',
    version: '1.0.0',
    models: {
      main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
    },
  });

  return {
    runtimeConfig: {
      body: {
        models: {
          main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
        },
        providerStatuses: [
          {provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY', keySet: true, verified: true},
          {provider: 'google', envVar: 'GOOGLE_API_KEY', keySet: true, verified: true},
        ],
      },
    },
    backend: {
      drafts,
      setWorkspaceContent(content: string): void {
        workspaceContent = content;
      },
      async listDrafts(): Promise<DraftFile[]> {
        return [...drafts.entries()].map(([filePath, content]) => ({
          filePath,
          content,
          updatedAt: new Date(0).toISOString(),
        }));
      },
      async readDraft(_userId: string, filePath: string): Promise<DraftFile | null> {
        const content = drafts.get(filePath);
        return content ? {filePath, content, updatedAt: new Date(0).toISOString()} : null;
      },
      async saveDraft(_userId: string, filePath: string, content: string): Promise<void> {
        drafts.set(filePath, content);
      },
      async deleteDraft(_userId: string, filePath: string): Promise<void> {
        drafts.delete(filePath);
      },
      async discardAllDrafts(): Promise<number> {
        const count = drafts.size;
        drafts.clear();
        return count;
      },
      async publishDrafts(): Promise<PublishResult> {
        return {commitRef: 'test', filesPublished: drafts.size};
      },
      async getWorkspace(): Promise<WorkspaceBundle> {
        return {
          agentId: 'test',
          files: [{path: 'amodal.json', content: workspaceContent}],
        };
      },
      async initialize(): Promise<void> {},
    },
  };
});

vi.mock('../../lib/startup.js', () => ({
  getBackend: vi.fn(async () => backend as StudioBackend),
}));

vi.mock('../../lib/runtime-client.js', () => ({
  resolveRuntimeContext: vi.fn(async () => ({runtimeUrl: 'https://runtime.example.com', agentId: 'agent'})),
}));

describe('modelCatalogRoutes', () => {
  beforeEach(() => {
    backend.drafts.clear();
    backend.setWorkspaceContent(JSON.stringify({
      name: 'test',
      version: '1.0.0',
      models: {
        main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'},
      },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(runtimeConfig.body), {status: 200})));
  });

  async function app(): Promise<Hono> {
    const {modelCatalogRoutes} = await import('./model-catalog.js');
    const hono = new Hono();
    hono.route('', modelCatalogRoutes);
    return hono;
  }

  it('returns model catalog data from runtime config and pricing table', async () => {
    const hono = await app();
    const response = await hono.request('/api/models/catalog');

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body['currentModel']).toEqual({provider: 'anthropic', model: 'claude-sonnet-4-20250514'});
    expect(body['source']).toBe('runtime');
    expect(JSON.stringify(body)).toContain('claude-sonnet-4-20250514');
  });

  it('saves selected main model as an amodal.json draft', async () => {
    const hono = await app();
    const response = await hono.request('/api/models/catalog', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: {provider: 'google', model: 'gemini-2.5-flash'},
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body['source']).toBe('draft');
    expect(body['currentModel']).toEqual({provider: 'google', model: 'gemini-2.5-flash'});

    const saved = JSON.parse(backend.drafts.get('amodal.json') ?? '{}') as Record<string, unknown>;
    expect(saved['models']).toMatchObject({
      main: {provider: 'google', model: 'gemini-2.5-flash'},
    });
    expect(saved['name']).toBe('test');
  });
});
