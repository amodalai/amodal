/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {RepoError} from '../repo/repo-types.js';
import {composePlan} from './setup-plan.js';

describe('composePlan', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(tmpdir(), 'compose-plan-'));
  });

  afterEach(async () => {
    await rm(repoPath, {recursive: true, force: true});
  });

  async function writeJson(rel: string, value: unknown): Promise<void> {
    const full = path.join(repoPath, rel);
    await mkdir(path.dirname(full), {recursive: true});
    await writeFile(full, JSON.stringify(value), 'utf-8');
  }

  async function writeFileAt(rel: string, content: string): Promise<void> {
    const full = path.join(repoPath, rel);
    await mkdir(path.dirname(full), {recursive: true});
    await writeFile(full, content, 'utf-8');
  }

  it('composes a Plan from template.json + connection package metadata', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      name: 'test-template',
      connections: [
        {
          label: 'CRM',
          description: 'Where leads and deals live.',
          options: ['@amodalai/connection-hubspot', '@amodalai/connection-salesforce'],
          required: true,
        },
        {
          label: 'Slack',
          description: 'Where the digest gets posted.',
          options: ['@amodalai/connection-slack'],
          required: true,
        },
      ],
    });
    await writeJson('node_modules/@amodalai/connection-hubspot/package.json', {
      name: '@amodalai/connection-hubspot',
      amodal: {
        displayName: 'HubSpot',
        icon: 'https://cdn.simpleicons.org/hubspot',
        category: 'CRM',
        auth: {type: 'oauth2'},
        oauth: {scopes: ['contacts', 'crm.deals']},
      },
    });
    await writeJson('node_modules/@amodalai/connection-salesforce/package.json', {
      name: '@amodalai/connection-salesforce',
      amodal: {
        displayName: 'Salesforce',
        category: 'CRM',
        auth: {type: 'oauth2'},
        oauth: {scopes: ['api', 'refresh_token']},
      },
    });
    await writeJson('node_modules/@amodalai/connection-slack/package.json', {
      name: '@amodalai/connection-slack',
      amodal: {
        displayName: 'Slack',
        category: 'Communication',
        auth: {type: 'bearer'},
        oauth: {scopes: ['channels:read', 'chat:write']},
      },
    });

    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/test-template',
    });

    expect(plan.templatePackage).toBe('@amodalai/test-template');
    expect(plan.slots).toHaveLength(2);

    const crm = plan.slots[0];
    expect(crm.label).toBe('CRM');
    expect(crm.description).toBe('Where leads and deals live.');
    expect(crm.required).toBe(true);
    expect(crm.multi).toBe(false);
    expect(crm.options).toHaveLength(2);
    expect(crm.options[0]).toMatchObject({
      packageName: '@amodalai/connection-hubspot',
      displayName: 'HubSpot',
      authType: 'oauth2',
      oauthScopes: ['contacts', 'crm.deals'],
      icon: 'https://cdn.simpleicons.org/hubspot',
      category: 'CRM',
    });

    const slack = plan.slots[1];
    expect(slack.options[0].displayName).toBe('Slack');
    expect(slack.options[0].authType).toBe('bearer');
  });

  it('returns a placeholder for un-installed options', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [
        {
          label: 'Ads',
          description: 'Paid acquisition.',
          options: ['@amodalai/connection-google-ads', '@amodalai/connection-meta-ads'],
          required: false,
          multi: true,
        },
      ],
    });
    await writeJson('node_modules/@amodalai/connection-google-ads/package.json', {
      name: '@amodalai/connection-google-ads',
      amodal: {displayName: 'Google Ads', auth: {type: 'oauth2'}},
    });
    // connection-meta-ads not installed.

    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/test-template',
    });

    const slot = plan.slots[0];
    expect(slot.required).toBe(false);
    expect(slot.multi).toBe(true);
    expect(slot.options[0]).toMatchObject({
      packageName: '@amodalai/connection-google-ads',
      displayName: 'Google Ads',
      authType: 'oauth2',
    });
    expect(slot.options[1]).toMatchObject({
      packageName: '@amodalai/connection-meta-ads',
      displayName: 'Meta Ads',
      authType: 'unknown',
      oauthScopes: [],
    });
  });

  it('emits a schedule config question from a JSON automation', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [],
    });
    await writeJson('node_modules/@amodalai/test-template/automations/digest.json', {
      title: 'Weekly digest',
      schedule: '0 16 * * 5',
    });

    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/test-template',
    });

    expect(plan.config).toHaveLength(1);
    expect(plan.config[0]).toMatchObject({
      key: 'schedule',
      question: 'When should the agent run?',
      required: true,
    });
    // Default option (template's own schedule) is first.
    expect(plan.config[0].options[0]).toEqual({label: 'Friday 4 PM', value: '0 16 * * 5'});
    expect(plan.completion.automationTitle).toBe('Weekly digest');
  });

  it('parses schedule + title from a markdown automation', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [],
    });
    await writeFileAt(
      'node_modules/@amodalai/test-template/automations/weekly.md',
      [
        '# Automation: Weekly Marketing Digest',
        '',
        '## Trigger',
        '',
        '- **Schedule**: `0 9 * * 1` (Monday at 9 AM)',
      ].join('\n'),
    );

    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/test-template',
    });

    expect(plan.completion.automationTitle).toBe('Weekly Marketing Digest');
    expect(plan.config[0].options[0]).toEqual({label: 'Monday 9 AM', value: '0 9 * * 1'});
  });

  it('returns an empty config[] when no automation has a schedule', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [],
    });
    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/test-template',
    });
    expect(plan.config).toEqual([]);
    expect(plan.completion.automationTitle).toBeNull();
  });

  it('shallow-merges template.json#setup polish into the Plan', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [],
      setup: {
        scheduleReasoning: 'gives your team the numbers before standup',
        completionSuggestions: ['add competitor tracking', 'change to Friday'],
      },
    });
    await writeJson('node_modules/@amodalai/test-template/automations/digest.json', {
      title: 'Weekly digest',
      schedule: '0 8 * * 1',
    });

    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/test-template',
    });

    expect(plan.config[0].reasoning).toBe('gives your team the numbers before standup');
    expect(plan.completion.suggestions).toEqual([
      'add competitor tracking',
      'change to Friday',
    ]);
  });

  it('throws CONFIG_NOT_FOUND when template.json is missing', async () => {
    await mkdir(path.join(repoPath, 'node_modules', '@amodalai', 'no-tpl'), {recursive: true});
    await expect(
      composePlan({repoPath, templatePackage: '@amodalai/no-tpl'}),
    ).rejects.toMatchObject({code: 'CONFIG_NOT_FOUND'});
  });

  it('throws CONFIG_PARSE_FAILED on malformed template.json', async () => {
    await mkdir(path.join(repoPath, 'node_modules', '@amodalai', 'broken'), {
      recursive: true,
    });
    await writeFileAt('node_modules/@amodalai/broken/template.json', '{not valid');
    await expect(
      composePlan({repoPath, templatePackage: '@amodalai/broken'}),
    ).rejects.toBeInstanceOf(RepoError);
  });

  it('throws CONFIG_VALIDATION_FAILED when a slot has no label', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [{description: 'no label here'}],
    });
    await expect(
      composePlan({repoPath, templatePackage: '@amodalai/test-template'}),
    ).rejects.toMatchObject({code: 'CONFIG_VALIDATION_FAILED'});
  });

  it('humanizes the package name into the completion title', async () => {
    await writeJson('node_modules/@amodalai/marketing-ops/template.json', {
      connections: [],
    });
    const plan = await composePlan({
      repoPath,
      templatePackage: '@amodalai/marketing-ops',
    });
    expect(plan.completion.title).toBe('Marketing Ops');
  });
});
