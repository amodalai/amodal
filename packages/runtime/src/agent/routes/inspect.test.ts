/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createInspectRouter} from './inspect.js';
import type {InspectRouterOptions} from './inspect.js';

const mockBundle = {
  connections: new Map([['crm', {name: 'crm', spec: {baseUrl: 'https://api.example.com', testPath: undefined}, surface: [], entities: null, rules: null, location: 'connections/crm'}]]),
  config: {name: 'test-agent', models: {main: {model: 'test-model', provider: 'test'}}},
  skills: [{name: 'triage'}, {name: 'investigate'}],
  automations: [{name: 'daily-scan'}],
  knowledge: [{name: 'api-docs'}],
};

function makeOpts(): InspectRouterOptions {
  return {
    getBundle: vi.fn(() => mockBundle) as unknown as InspectRouterOptions['getBundle'],
    getMcpManager: vi.fn(async () => undefined),
    repoPath: '/test/repo',
  };
}

function createTestApp(opts: InspectRouterOptions): express.Express {
  const app = express();
  app.use(createInspectRouter(opts));
  return app;
}

describe('repo-inspect route', () => {
  let opts: InspectRouterOptions;

  beforeEach(() => {
    opts = makeOpts();
  });

  it('should return repo context info', async () => {
    const app = createTestApp(opts);
    const res = await request(app).get('/inspect/context');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('repo_path', '/test/repo');
    expect(res.body).toHaveProperty('name', 'test-agent');
    expect(res.body['connections']).toEqual([expect.objectContaining({name: 'crm'})]);
    expect(res.body['skills']).toEqual(['triage', 'investigate']);
    expect(res.body['automations']).toEqual(['daily-scan']);
    expect(res.body['knowledge']).toEqual(['api-docs']);
  });

  it('should handle missing repo', async () => {
    (opts.getBundle as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const app = createTestApp(opts);
    const res = await request(app).get('/inspect/context');

    expect(res.status).toBe(500);
    expect(res.body['error']['code']).toBe('INSPECT_FAILED');
  });
});
