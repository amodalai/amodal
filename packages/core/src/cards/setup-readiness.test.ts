/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it} from 'vitest';

import type {SetupPlan, SetupState} from '@amodalai/types';
import {emptySetupState} from '@amodalai/types';

import {validateSetupReadiness} from './setup-readiness.js';

function makePlan(overrides?: Partial<SetupPlan>): SetupPlan {
  return {
    templatePackage: '@amodalai/test-template',
    slots: [],
    config: [],
    completion: {title: 'Test', suggestions: [], automationTitle: null},
    ...overrides,
  };
}

function makeState(overrides?: Partial<SetupState>): SetupState {
  return {...emptySetupState('configuring'), ...overrides};
}

describe('validateSetupReadiness', () => {
  it('returns ready: true when there is nothing to satisfy', () => {
    const result = validateSetupReadiness({state: makeState(), plan: makePlan()});
    expect(result).toEqual({ready: true, warnings: []});
  });

  it('flags a required slot with no completed option as block', () => {
    const result = validateSetupReadiness({
      state: makeState(),
      plan: makePlan({
        slots: [
          {
            label: 'Slack',
            description: 'Where the digest gets posted.',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-slack',
                displayName: 'Slack',
                authType: 'bearer',
                oauthScopes: [],
              },
            ],
          },
        ],
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      kind: 'missing_required_slot',
      severity: 'block',
      target: 'Slack',
    });
    expect(result.warnings[0].message).toContain('Slack');
  });

  it('treats a completed slot as configured (no warning)', () => {
    const result = validateSetupReadiness({
      state: makeState({
        completed: [
          {
            slotLabel: 'Slack',
            packageName: '@amodalai/connection-slack',
            connectedAt: '2026-04-30T10:00:00Z',
            validatedAt: '2026-04-30T10:00:05Z',
            validationFormatted: 'Found 12 channels',
          },
        ],
      }),
      plan: makePlan({
        slots: [
          {
            label: 'Slack',
            description: 'Where the digest gets posted.',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-slack',
                displayName: 'Slack',
                authType: 'bearer',
                oauthScopes: [],
              },
            ],
          },
        ],
      }),
    });
    expect(result).toEqual({ready: true, warnings: []});
  });

  it('counts ANY option for a multi-option slot — first-wins', () => {
    // CRM = HubSpot or Salesforce; user connected HubSpot.
    const result = validateSetupReadiness({
      state: makeState({
        completed: [
          {
            slotLabel: 'CRM',
            packageName: '@amodalai/connection-hubspot',
            connectedAt: '2026-04-30T10:00:00Z',
            validatedAt: null,
            validationFormatted: null,
          },
        ],
      }),
      plan: makePlan({
        slots: [
          {
            label: 'CRM',
            description: 'Where leads and deals live.',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-hubspot',
                displayName: 'HubSpot',
                authType: 'oauth2',
                oauthScopes: [],
              },
              {
                packageName: '@amodalai/connection-salesforce',
                displayName: 'Salesforce',
                authType: 'oauth2',
                oauthScopes: [],
              },
            ],
          },
        ],
      }),
    });
    expect(result.ready).toBe(true);
  });

  it("missing-slot message lists multi-option slots' choices", () => {
    const result = validateSetupReadiness({
      state: makeState(),
      plan: makePlan({
        slots: [
          {
            label: 'CRM',
            description: 'CRM',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-hubspot',
                displayName: 'HubSpot',
                authType: 'oauth2',
                oauthScopes: [],
              },
              {
                packageName: '@amodalai/connection-salesforce',
                displayName: 'Salesforce',
                authType: 'oauth2',
                oauthScopes: [],
              },
            ],
          },
        ],
      }),
    });
    expect(result.warnings[0].message).toContain('HubSpot or Salesforce');
  });

  it('connectionsStatus overrides state.completed[] when provided', () => {
    // Agent's record claims Slack is completed, but live env-var
    // status says configured: false (e.g. token was revoked).
    const result = validateSetupReadiness({
      state: makeState({
        completed: [
          {
            slotLabel: 'Slack',
            packageName: '@amodalai/connection-slack',
            connectedAt: '2026-04-30T10:00:00Z',
            validatedAt: '2026-04-30T10:00:05Z',
            validationFormatted: 'Found 12 channels',
          },
        ],
      }),
      plan: makePlan({
        slots: [
          {
            label: 'Slack',
            description: 'Slack',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-slack',
                displayName: 'Slack',
                authType: 'bearer',
                oauthScopes: [],
              },
            ],
          },
        ],
      }),
      // Live status: still configured (env vars set).
      connectionsStatus: {
        '@amodalai/connection-slack': {configured: true, envVarsSet: ['SLACK_BOT_TOKEN']},
      },
    });
    expect(result.ready).toBe(true);
  });

  it('connectionsStatus configured: true rescues a slot the agent did not record', () => {
    // User configured Slack out-of-band via the per-connection page;
    // the agent's state.completed[] is empty but env vars are set.
    const result = validateSetupReadiness({
      state: makeState(),
      plan: makePlan({
        slots: [
          {
            label: 'Slack',
            description: 'Slack',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-slack',
                displayName: 'Slack',
                authType: 'bearer',
                oauthScopes: [],
              },
            ],
          },
        ],
      }),
      connectionsStatus: {
        '@amodalai/connection-slack': {configured: true, envVarsSet: ['SLACK_BOT_TOKEN']},
      },
    });
    expect(result.ready).toBe(true);
  });

  it('flags a missing required config answer as block', () => {
    const result = validateSetupReadiness({
      state: makeState(),
      plan: makePlan({
        config: [
          {
            key: 'schedule',
            question: 'When should the agent run?',
            options: [
              {label: 'Monday 8 AM', value: '0 8 * * 1'},
              {label: 'Custom', value: 'custom'},
            ],
            required: true,
          },
        ],
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      kind: 'missing_config_answer',
      severity: 'block',
      target: 'schedule',
    });
  });

  it('considers a config answer present when the value is set (even falsy primitives)', () => {
    // Numbers, booleans, empty strings — all valid answers.
    for (const value of [0, false, '']) {
      const result = validateSetupReadiness({
        state: makeState({configAnswers: {threshold: value}}),
        plan: makePlan({
          config: [
            {
              key: 'threshold',
              question: '?',
              options: [
                {label: 'A', value: 'a'},
                {label: 'B', value: 'b'},
              ],
              required: true,
            },
          ],
        }),
      });
      expect(result.ready).toBe(true);
    }
  });

  it('skips optional slots and optional config questions', () => {
    const result = validateSetupReadiness({
      state: makeState(),
      plan: makePlan({
        slots: [
          {
            label: 'Optional ad platform',
            description: 'For richer data.',
            required: false,
            multi: true,
            options: [
              {
                packageName: '@amodalai/connection-google-ads',
                displayName: 'Google Ads',
                authType: 'oauth2',
                oauthScopes: [],
              },
            ],
          },
        ],
        config: [
          {
            key: 'verbose',
            question: '?',
            options: [
              {label: 'Yes', value: 'y'},
              {label: 'No', value: 'n'},
            ],
            required: false,
          },
        ],
      }),
    });
    expect(result).toEqual({ready: true, warnings: []});
  });

  it('aggregates multiple warnings across slots and config in stable order', () => {
    const result = validateSetupReadiness({
      state: makeState(),
      plan: makePlan({
        slots: [
          {
            label: 'CRM',
            description: '.',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-hubspot',
                displayName: 'HubSpot',
                authType: 'oauth2',
                oauthScopes: [],
              },
            ],
          },
          {
            label: 'Slack',
            description: '.',
            required: true,
            multi: false,
            options: [
              {
                packageName: '@amodalai/connection-slack',
                displayName: 'Slack',
                authType: 'bearer',
                oauthScopes: [],
              },
            ],
          },
        ],
        config: [
          {
            key: 'schedule',
            question: '?',
            options: [
              {label: 'A', value: 'a'},
              {label: 'B', value: 'b'},
            ],
            required: true,
          },
        ],
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.warnings.map((w) => w.target)).toEqual(['CRM', 'Slack', 'schedule']);
  });
});
