/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeConnectionsStatus } from './connections-status.js';

const REPO_PATH_ENV = 'REPO_PATH';

describe('computeConnectionsStatus', () => {
  let repoPath: string;
  const originalRepoPath = process.env[REPO_PATH_ENV];

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(tmpdir(), 'connections-status-'));
    process.env[REPO_PATH_ENV] = repoPath;
  });

  afterEach(async () => {
    if (originalRepoPath !== undefined) {
      process.env[REPO_PATH_ENV] = originalRepoPath;
    } else {
      delete process.env[REPO_PATH_ENV];
    }
    await rm(repoPath, { recursive: true, force: true });
  });

  async function writeAmodalJson(packages: unknown[]): Promise<void> {
    await writeFile(
      path.join(repoPath, 'amodal.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', packages }),
      'utf-8',
    );
  }

  async function writeConnectionPkg(
    packageName: string,
    envVars: Record<string, string>,
  ): Promise<void> {
    const dir = path.join(repoPath, 'node_modules', ...packageName.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: packageName,
        amodal: { auth: { envVars } },
      }),
      'utf-8',
    );
  }

  it('returns empty when REPO_PATH is unset', async () => {
    delete process.env[REPO_PATH_ENV];
    const map = await computeConnectionsStatus();
    expect(map).toEqual({});
  });

  it('returns empty when amodal.json is missing', async () => {
    const map = await computeConnectionsStatus();
    expect(map).toEqual({});
  });

  it('marks a connection configured when every required env var is set', async () => {
    await writeAmodalJson(['@amodalai/connection-slack']);
    await writeConnectionPkg('@amodalai/connection-slack', {
      SLACK_BOT_TOKEN: 'Bot User OAuth token (xoxb-…)',
    });
    process.env['SLACK_BOT_TOKEN'] = 'xoxb-test-token';
    try {
      const map = await computeConnectionsStatus();
      expect(map['@amodalai/connection-slack']).toEqual({
        configured: true,
        envVarsSet: ['SLACK_BOT_TOKEN'],
      });
    } finally {
      delete process.env['SLACK_BOT_TOKEN'];
    }
  });

  it('marks a connection unconfigured when any required env var is empty', async () => {
    await writeAmodalJson(['@amodalai/connection-stripe']);
    await writeConnectionPkg('@amodalai/connection-stripe', {
      STRIPE_API_KEY: 'Stripe secret key',
      STRIPE_WEBHOOK_SECRET: 'Webhook signing secret',
    });
    process.env['STRIPE_API_KEY'] = 'sk_test_x';
    // STRIPE_WEBHOOK_SECRET intentionally unset.
    try {
      const map = await computeConnectionsStatus();
      expect(map['@amodalai/connection-stripe']).toEqual({
        configured: false,
        envVarsSet: ['STRIPE_API_KEY'],
      });
    } finally {
      delete process.env['STRIPE_API_KEY'];
    }
  });

  it('treats a package with no envVars as configured (zero requirements)', async () => {
    // Templates / skill packages don't declare auth.envVars; they
    // shouldn't show up as misconfigured just because they have no
    // envVars to satisfy.
    await writeAmodalJson(['@amodalai/marketing-ops']);
    await writeConnectionPkg('@amodalai/marketing-ops', {});
    const map = await computeConnectionsStatus();
    expect(map['@amodalai/marketing-ops']).toEqual({
      configured: true,
      envVarsSet: [],
    });
  });

  it('skips a package that is declared but not installed', async () => {
    await writeAmodalJson(['@amodalai/connection-not-installed']);
    const map = await computeConnectionsStatus();
    expect(map).toEqual({});
  });

  it('skips a package that has no amodal.auth block', async () => {
    await writeAmodalJson(['@amodalai/skill-thing']);
    const dir = path.join(repoPath, 'node_modules', '@amodalai', 'skill-thing');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@amodalai/skill-thing' }),
      'utf-8',
    );
    const map = await computeConnectionsStatus();
    expect(map).toEqual({});
  });

  it('handles object-form package entries ({package, use}) alongside bare strings', async () => {
    // amodal.json#packages can be either bare strings or
    // {package, use} objects per the AmodalConfigSchema.
    await writeAmodalJson([
      '@amodalai/connection-slack',
      { package: '@amodalai/connection-twilio', use: ['connections.twilio'] },
    ]);
    await writeConnectionPkg('@amodalai/connection-slack', {
      SLACK_BOT_TOKEN: 'tok',
    });
    await writeConnectionPkg('@amodalai/connection-twilio', {
      TWILIO_ACCOUNT_SID: 'sid',
      TWILIO_AUTH_TOKEN: 'tok',
    });
    process.env['SLACK_BOT_TOKEN'] = 'xoxb-x';
    process.env['TWILIO_ACCOUNT_SID'] = 'AC123';
    try {
      const map = await computeConnectionsStatus();
      expect(map['@amodalai/connection-slack']?.configured).toBe(true);
      // Twilio has SID but not AUTH_TOKEN -> partially configured -> false.
      expect(map['@amodalai/connection-twilio']).toEqual({
        configured: false,
        envVarsSet: ['TWILIO_ACCOUNT_SID'],
      });
    } finally {
      delete process.env['SLACK_BOT_TOKEN'];
      delete process.env['TWILIO_ACCOUNT_SID'];
    }
  });

  it('never echoes env-var values in the response', async () => {
    await writeAmodalJson(['@amodalai/connection-slack']);
    await writeConnectionPkg('@amodalai/connection-slack', {
      SLACK_BOT_TOKEN: 'tok',
    });
    process.env['SLACK_BOT_TOKEN'] = 'xoxb-secret-do-not-leak';
    try {
      const map = await computeConnectionsStatus();
      const serialized = JSON.stringify(map);
      expect(serialized).not.toContain('xoxb-secret-do-not-leak');
      expect(serialized).toContain('SLACK_BOT_TOKEN');
    } finally {
      delete process.env['SLACK_BOT_TOKEN'];
    }
  });
});
