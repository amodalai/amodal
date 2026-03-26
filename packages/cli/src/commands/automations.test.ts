/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {runAutomationsList, runAutomationsStart, runAutomationsStop, runAutomationsRun} from './automations.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('automations CLI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('list', () => {
    it('should list automations from server', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        automations: [
          {name: 'monitor', title: 'Zone Monitor', schedule: '*/5 * * * *', webhookTriggered: false, running: true},
          {name: 'alerts', title: 'Alert Handler', webhookTriggered: true, running: true},
        ],
      }));

      const code = await runAutomationsList({url: 'http://test:3847'});
      expect(code).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith('http://test:3847/automations', {method: 'GET'});
    });

    it('should return 1 on error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const code = await runAutomationsList();
      expect(code).toBe(1);
    });
  });

  describe('start', () => {
    it('should start an automation', async () => {
      mockFetch.mockResolvedValue(jsonResponse({status: 'started', automation: 'monitor'}));

      const code = await runAutomationsStart('monitor', {url: 'http://test:3847'});
      expect(code).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith('http://test:3847/automations/monitor/start', {method: 'POST'});
    });

    it('should return 1 on error', async () => {
      mockFetch.mockResolvedValue(jsonResponse({error: 'Already running'}, 400));

      const code = await runAutomationsStart('monitor');
      expect(code).toBe(1);
    });
  });

  describe('stop', () => {
    it('should stop an automation', async () => {
      mockFetch.mockResolvedValue(jsonResponse({status: 'stopped', automation: 'monitor'}));

      const code = await runAutomationsStop('monitor', {url: 'http://test:3847'});
      expect(code).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith('http://test:3847/automations/monitor/stop', {method: 'POST'});
    });
  });

  describe('run', () => {
    it('should trigger an automation', async () => {
      mockFetch.mockResolvedValue(jsonResponse({status: 'triggered', automation: 'monitor'}));

      const code = await runAutomationsRun('monitor', {url: 'http://test:3847'});
      expect(code).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith('http://test:3847/automations/monitor/run', {method: 'POST'});
    });
  });
});
