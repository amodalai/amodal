/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createServer} from 'node:http';
import type {Server} from 'node:http';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockOpen = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('open', () => ({
  default: mockOpen,
}));

describe('runLogin', () => {
  let stderrOutput: string;
  let mockPlatformServer: Server;
  let platformPort: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });

    // Start a mock platform API server (for /api/me verification)
    await new Promise<void>((resolve) => {
      mockPlatformServer = createServer((req, res) => {
        if (req.url === '/api/me') {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            user: {email: 'test@example.com', name: 'Test User'},
            org: {name: 'Test Org'},
          }));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });
      mockPlatformServer.listen(0, '127.0.0.1', () => {
        const addr = mockPlatformServer.address();
        if (addr && typeof addr !== 'string') {
          platformPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(() => {
    mockPlatformServer?.close();
  });

  it('should skip login when already authenticated', async () => {
    const url = `http://127.0.0.1:${platformPort}`;
    mockReadFile.mockResolvedValue(JSON.stringify({
      platform: {url, token: 'existing-token'},
    }));

    const {runLogin} = await import('./login.js');
    const result = await runLogin({platformUrl: url});
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Already logged in');
  });

  it('should open browser and complete login on callback', async () => {
    // Mock open to simulate browser: extract port from URL and call callback
    mockOpen.mockImplementation(async (loginUrl: string) => {
      const url = new URL(loginUrl);
      const port = url.searchParams.get('port');
      const state = url.searchParams.get('state');
      // Simulate browser redirect to callback
      await fetch(
        `http://127.0.0.1:${port}/callback?token=test-jwt-token&refresh_token=test-refresh&state=${state}`,
      );
    });

    const {runLogin} = await import('./login.js');
    const result = await runLogin({
      platformUrl: `http://127.0.0.1:${platformPort}`,
      adminUrl: 'http://localhost:9999', // Not actually hit — open is mocked
    });
    expect(result).toBe(0);
    expect(stderrOutput).toContain('Logged in as test@example.com');
    expect(stderrOutput).toContain('org: Test Org');
    expect(mockWriteFile).toHaveBeenCalled();

    // Verify the saved content
    const writeCall = mockWriteFile.mock.calls[0];
     
    const content = writeCall[1] as string;
    expect(content).toContain('test-jwt-token');
    expect(content).toContain('test-refresh');
  });

  it('should open admin UI URL, not platform API', async () => {
    mockOpen.mockImplementation(async (loginUrl: string) => {
      const url = new URL(loginUrl);
      // Verify it opens the admin UI
      expect(url.origin).toBe('http://localhost:3333');
      expect(url.pathname).toBe('/cli-auth');
      expect(url.searchParams.get('port')).toBeTruthy();
      expect(url.searchParams.get('state')).toBeTruthy();

      const port = url.searchParams.get('port');
      const state = url.searchParams.get('state');
      await fetch(
        `http://127.0.0.1:${port}/callback?token=jwt&state=${state}`,
      );
    });

    const {runLogin} = await import('./login.js');
    await runLogin({
      platformUrl: `http://127.0.0.1:${platformPort}`,
      adminUrl: 'http://localhost:3333',
    });

    expect(mockOpen).toHaveBeenCalledOnce();
  });

  it('should return 1 when state mismatches', async () => {
    mockOpen.mockImplementation(async (loginUrl: string) => {
      const url = new URL(loginUrl);
      const port = url.searchParams.get('port');
      // Send back wrong state
      await fetch(
        `http://127.0.0.1:${port}/callback?token=test-jwt&state=wrong-state`,
      );
    });

    const {runLogin} = await import('./login.js');
    const result = await runLogin({
      platformUrl: `http://127.0.0.1:${platformPort}`,
      adminUrl: 'http://localhost:9999',
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('State mismatch');
  });

  it('should handle callback error from browser', async () => {
    mockOpen.mockImplementation(async (loginUrl: string) => {
      const url = new URL(loginUrl);
      const port = url.searchParams.get('port');
      await fetch(
        `http://127.0.0.1:${port}/callback?error=access_denied`,
      );
    });

    const {runLogin} = await import('./login.js');
    const result = await runLogin({
      platformUrl: `http://127.0.0.1:${platformPort}`,
      adminUrl: 'http://localhost:9999',
    });
    expect(result).toBe(1);
    expect(stderrOutput).toContain('access_denied');
  });

  it('should save credentials with restricted file permissions', async () => {
    mockOpen.mockImplementation(async (loginUrl: string) => {
      const url = new URL(loginUrl);
      const port = url.searchParams.get('port');
      const state = url.searchParams.get('state');
      await fetch(
        `http://127.0.0.1:${port}/callback?token=jwt123&state=${state}`,
      );
    });

    const {runLogin} = await import('./login.js');
    await runLogin({
      platformUrl: `http://127.0.0.1:${platformPort}`,
      adminUrl: 'http://localhost:9999',
    });

    const writeCall = mockWriteFile.mock.calls[0];
     
    const options = writeCall[2] as {mode: number};
    expect(options.mode).toBe(0o600);
  });
});
