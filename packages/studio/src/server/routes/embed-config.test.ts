/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioBackend } from '../../lib/backend.js';
import type { DraftFile, PublishResult, WorkspaceBundle } from '../../lib/types.js';

const { backend } = vi.hoisted(() => {
  const drafts = new Map<string, string>();
  let workspaceContent = JSON.stringify({
    name: 'test',
    version: '1.0.0',
  });

  return {
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
        return content
          ? { filePath, content, updatedAt: new Date(0).toISOString() }
          : null;
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
        return { commitRef: 'test', filesPublished: drafts.size };
      },
      async getWorkspace(): Promise<WorkspaceBundle> {
        return {
          agentId: 'test',
          files: [{ path: 'amodal.json', content: workspaceContent }],
        };
      },
      async initialize(): Promise<void> {},
    },
  };
});

vi.mock('../../lib/startup.js', () => ({
  getBackend: vi.fn(async () => backend as StudioBackend),
}));

vi.mock('../../lib/config.js', () => ({
  getRuntimeUrl: vi.fn(() => 'https://agent.example.com'),
}));

describe('embedConfigRoutes', () => {
  async function app(): Promise<Hono> {
    const { embedConfigRoutes } = await import('./embed-config.js');
    const hono = new Hono();
    hono.route('', embedConfigRoutes);
    return hono;
  }

  beforeEach(() => {
    backend.drafts.clear();
    backend.setWorkspaceContent(JSON.stringify({ name: 'test', version: '1.0.0' }));
  });

  it('returns defaults plus a generated snippet when amodal.json has no embed block', async () => {
    const hono = await app();
    const response = await hono.request('/api/embed-config');

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body['source']).toBe('file');
    expect(body['config']).toMatchObject({ position: 'right', historyEnabled: true });
    expect(body['snippet']).toContain('https://agent.example.com');
  });

  it('saves embed settings as an amodal.json draft', async () => {
    const hono = await app();
    const response = await hono.request('/api/embed-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          position: 'bottom',
          defaultOpen: true,
          allowedDomains: ['APP.EXAMPLE.COM'],
          theme: { headerText: 'Support' },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body['source']).toBe('draft');
    expect(body['draftPath']).toBe('amodal.json');

    const saved = JSON.parse(backend.drafts.get('amodal.json') ?? '{}') as Record<string, unknown>;
    expect(saved['name']).toBe('test');
    expect(saved['embed']).toMatchObject({
      position: 'bottom',
      defaultOpen: true,
      allowedDomains: ['app.example.com'],
      theme: { headerText: 'Support' },
    });
  });
});

