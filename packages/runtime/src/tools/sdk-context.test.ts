/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it, vi} from 'vitest';

import {PermissionError, type EmitEvent, type ToolDbHandle} from './context.js';
import type {FsBackend} from './fs/index.js';
import type {PackagePermissions} from './permissions.js';
import {createSdkToolContext} from './sdk-context.js';

function makeFsBackend(): FsBackend {
  return {
    readRepoFile: vi.fn().mockResolvedValue('content'),
    writeRepoFile: vi.fn().mockResolvedValue(undefined),
    readManyRepoFiles: vi.fn().mockResolvedValue([]),
    listRepoFiles: vi.fn().mockResolvedValue({directories: [], files: []}),
    deleteRepoFile: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb(): ToolDbHandle {
  return {execute: vi.fn().mockResolvedValue([])};
}

function buildCtx(opts: {permissions: PackagePermissions['permissions']}): {
  ctx: ReturnType<typeof createSdkToolContext>;
  emit: ReturnType<typeof vi.fn>;
  fs: FsBackend;
  db: ToolDbHandle;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fs = makeFsBackend();
  const db = makeDb();
  const fetch = vi.fn().mockResolvedValue(new Response(null));
  const emit = vi.fn();
  const ctx = createSdkToolContext({
    agentId: 'agent_1',
    scopeId: '',
    sessionId: 'sess_1',
    signal: new AbortController().signal,
    toolName: 'test_tool',
    packagePermissions: {packageName: '@amodalai/agent-admin', permissions: opts.permissions},
    fs,
    db,
    fetch: fetch as unknown as typeof globalThis.fetch,
    emit,
  });
  return {ctx, emit, fs, db, fetch};
}

describe('createSdkToolContext', () => {
  describe('identity fields', () => {
    it('exposes agentId / scopeId / sessionId verbatim', () => {
      const {ctx} = buildCtx({permissions: []});
      expect(ctx.agentId).toBe('agent_1');
      expect(ctx.scopeId).toBe('');
      expect(ctx.sessionId).toBe('sess_1');
    });
  });

  describe('emit + log', () => {
    it('forwards emit calls', () => {
      const {ctx, emit} = buildCtx({permissions: []});
      const event: EmitEvent = {type: 'text', text: 'hi'};
      ctx.emit(event);
      expect(emit).toHaveBeenCalledWith(event);
    });

    it('log() emits a text event', () => {
      const {ctx, emit} = buildCtx({permissions: []});
      ctx.log('hello');
      expect(emit).toHaveBeenCalledWith({type: 'text', text: 'hello'});
    });

    it('emit and log work without any permissions declared', () => {
      const {ctx} = buildCtx({permissions: []});
      expect(() => ctx.log('no perms needed')).not.toThrow();
    });
  });

  describe('fs gating', () => {
    it('readRepoFile throws PermissionError without fs.read', async () => {
      const {ctx} = buildCtx({permissions: []});
      await expect(ctx.fs.readRepoFile('a.txt')).rejects.toBeInstanceOf(PermissionError);
    });

    it('readRepoFile passes with fs.read', async () => {
      const {ctx, fs} = buildCtx({permissions: ['fs.read']});
      const content = await ctx.fs.readRepoFile('a.txt');
      expect(content).toBe('content');
      expect(fs.readRepoFile).toHaveBeenCalledWith('a.txt');
    });

    it('writeRepoFile throws without fs.write even if fs.read is granted', async () => {
      const {ctx} = buildCtx({permissions: ['fs.read']});
      await expect(ctx.fs.writeRepoFile('a.txt', 'x')).rejects.toBeInstanceOf(PermissionError);
    });

    it('listRepoFiles requires fs.read', async () => {
      const {ctx} = buildCtx({permissions: []});
      await expect(ctx.fs.listRepoFiles('.')).rejects.toBeInstanceOf(PermissionError);
    });

    it('deleteRepoFile requires fs.write', async () => {
      const {ctx} = buildCtx({permissions: ['fs.read']});
      await expect(ctx.fs.deleteRepoFile('a.txt')).rejects.toBeInstanceOf(PermissionError);
    });

    it('PermissionError names the tool, package, and missing permission', async () => {
      const {ctx} = buildCtx({permissions: []});
      await expect(ctx.fs.readRepoFile('a.txt')).rejects.toMatchObject({
        toolName: 'test_tool',
        packageName: '@amodalai/agent-admin',
        permission: 'fs.read',
      });
    });
  });

  describe('db gating', () => {
    it('execute throws without db.write', async () => {
      const {ctx} = buildCtx({permissions: ['db.read']});
      await expect(ctx.db.execute({sql: 'SELECT 1'})).rejects.toBeInstanceOf(PermissionError);
    });

    it('execute passes with db.read + db.write', async () => {
      const {ctx, db} = buildCtx({permissions: ['db.read', 'db.write']});
      await ctx.db.execute({sql: 'SELECT 1'});
      expect(db.execute).toHaveBeenCalled();
    });
  });

  describe('fetch gating', () => {
    it('throws without net.fetch', async () => {
      const {ctx} = buildCtx({permissions: []});
      await expect(ctx.fetch('https://example.com')).rejects.toBeInstanceOf(PermissionError);
    });

    it('forwards through underlying fetch when granted', async () => {
      const {ctx, fetch} = buildCtx({permissions: ['net.fetch']});
      await ctx.fetch('https://example.com');
      expect(fetch).toHaveBeenCalled();
    });

    it('injects ctx.signal when caller did not pass one', async () => {
      const {ctx, fetch} = buildCtx({permissions: ['net.fetch']});
      await ctx.fetch('https://example.com');
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      expect(init.signal).toBe(ctx.signal);
    });

    it('respects an explicit signal when caller passes one', async () => {
      const {ctx, fetch} = buildCtx({permissions: ['net.fetch']});
      const explicit = new AbortController().signal;
      await ctx.fetch('https://example.com', {signal: explicit});
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      expect(init.signal).toBe(explicit);
    });
  });
});
