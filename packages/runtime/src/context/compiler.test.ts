/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Context Compiler Tests.
 *
 * Covers:
 * 1. Basic compilation — identity, core behavior, error handling
 * 2. Gotcha G9 — system prompt includes ALL context (skills, knowledge, connections)
 * 3. Description handling
 * 4. Store schemas — rendered as tables in the prompt
 * 5. Field guidance — generated from connection access configs
 * 6. Scope labels — resolved from row scoping rules
 * 7. Alternative lookups — generated from connection configs
 * 8. basePrompt override — short-circuits compilation
 * 9. Contributions — per-section token estimates
 * 10. Plan mode
 */

import {describe, it, expect} from 'vitest';
import {compileContext} from './compiler.js';
import type {CompilerInput, CompilerConnection, CompilerSkill, CompilerKnowledge, CompilerStore} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConnection(overrides?: Partial<CompilerConnection>): CompilerConnection {
  return {
    name: 'stripe',
    description: 'Payment processing',
    endpoints: [
      {method: 'GET', path: '/v1/customers', description: 'List customers'},
      {method: 'POST', path: '/v1/charges', description: 'Create a charge'},
    ],
    entities: '**Customer** — represents a paying customer',
    rules: 'Always scope queries to the current tenant.',
    ...overrides,
  };
}

function makeSkill(overrides?: Partial<CompilerSkill>): CompilerSkill {
  return {
    name: 'revenue-report',
    description: 'Generate a monthly revenue report from Stripe data.',
    trigger: 'When the user asks about revenue or monthly reports',
    body: 'Step 1: Query /v1/charges with date filter.\nStep 2: Aggregate by status.\nStep 3: Present as a table.',
    ...overrides,
  };
}

function makeKnowledge(overrides?: Partial<CompilerKnowledge>): CompilerKnowledge {
  return {
    name: 'formatting-rules',
    title: 'Formatting Rules',
    body: 'Always use markdown tables for tabular data. Currency values use USD with 2 decimal places.',
    ...overrides,
  };
}

function makeStore(overrides?: Partial<CompilerStore>): CompilerStore {
  return {
    name: 'deals',
    entity: {
      name: 'Deal',
      key: '{company}_{quarter}',
      schema: {
        company: {type: 'string'},
        amount: {type: 'number', min: 0},
        stage: {type: 'enum', values: ['lead', 'qualified', 'closed']},
        contacts: {type: 'array', item: {type: 'string'}},
        closedAt: {type: 'datetime', nullable: true},
      },
    },
    ...overrides,
  };
}

function makeFullInput(): CompilerInput {
  return {
    name: 'Sales Agent',
    description: 'A B2B sales intelligence agent for Acme Corp',
    agentOverride: 'You specialize in enterprise sales pipeline analysis.',
    connections: [makeConnection()],
    skills: [makeSkill()],
    knowledge: [makeKnowledge()],
    stores: [makeStore()],
  };
}

// ---------------------------------------------------------------------------
// 1. Basic compilation
// ---------------------------------------------------------------------------

describe('compileContext', () => {
  it('produces a prompt with identity, core behavior, and error handling', () => {
    const result = compileContext({name: 'Test Agent'});

    expect(result.source).toBe('compiled');
    expect(result.systemPrompt).toContain('You are Test Agent.');
    expect(result.systemPrompt).toContain('## How you work');
    expect(result.systemPrompt).toContain('## Error handling');
  });

  it('includes description in identity line', () => {
    const result = compileContext({name: 'Bot', description: 'A helpful assistant'});

    expect(result.systemPrompt).toContain('You are Bot — A helpful assistant.');
  });

  // -------------------------------------------------------------------------
  // 2. Gotcha G9 — ALL context included
  // -------------------------------------------------------------------------

  it('G9: includes connection endpoints, skill bodies, and knowledge bodies', () => {
    const input = makeFullInput();
    const result = compileContext(input);
    const prompt = result.systemPrompt;

    // Connection endpoints
    expect(prompt).toContain('GET /v1/customers');
    expect(prompt).toContain('POST /v1/charges');
    expect(prompt).toContain('Connection: stripe');

    // Skill body (not just description)
    expect(prompt).toContain('Step 1: Query /v1/charges');
    expect(prompt).toContain('revenue-report');

    // Knowledge body (not just title)
    expect(prompt).toContain('Always use markdown tables for tabular data');
    expect(prompt).toContain('Formatting Rules');

    // Store schema
    expect(prompt).toContain('deals');
    expect(prompt).toContain('Deal');
  });

  it('G9: compiled prompt length is substantial with full config', () => {
    const input = makeFullInput();
    const result = compileContext(input);

    // A full config should produce a prompt well over 1K chars
    // (the bug from G9 dropped from 30K to 1.3K)
    expect(result.systemPrompt.length).toBeGreaterThan(2000);
  });

  it('G9: section order matches design doc priority (skills before connections)', () => {
    const input = makeFullInput();
    const result = compileContext(input);
    const prompt = result.systemPrompt;

    const skillsIndex = prompt.indexOf('## Skills');
    const connectionsIndex = prompt.indexOf('## Connected systems');
    const knowledgeIndex = prompt.indexOf('## Knowledge Base');
    const storesIndex = prompt.indexOf('## Data Stores');

    // Skills before connections (skills trimmed first when budget is added)
    expect(skillsIndex).toBeLessThan(connectionsIndex);
    // Knowledge before connections
    expect(knowledgeIndex).toBeLessThan(connectionsIndex);
    // Stores after connections
    expect(storesIndex).toBeGreaterThan(connectionsIndex);
  });

  // -------------------------------------------------------------------------
  // 3. Description handling
  // -------------------------------------------------------------------------

  it('description appears in the identity line', () => {
    const result = compileContext({
      name: 'Agent',
      description: 'A sales agent',
    });

    expect(result.systemPrompt).toContain('You are Agent — A sales agent.');
    expect(result.systemPrompt).not.toContain('undefined');
  });

  // -------------------------------------------------------------------------
  // 4. Connections
  // -------------------------------------------------------------------------

  it('renders connection endpoints, entities, and rules', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [makeConnection()],
    });
    const prompt = result.systemPrompt;

    expect(prompt).toContain('## Connected systems');
    expect(prompt).toContain('### Connection: stripe');
    expect(prompt).toContain('Payment processing');
    expect(prompt).toContain('**Available Endpoints:**');
    expect(prompt).toContain('- GET /v1/customers — List customers');
    expect(prompt).toContain('**Customer** — represents a paying customer');
    expect(prompt).toContain('Always scope queries to the current tenant.');
    expect(prompt).toContain('Use `request` with the connection name');
  });

  it('renders multiple connections', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [
        makeConnection({name: 'stripe'}),
        makeConnection({name: 'slack', description: 'Team messaging', endpoints: [{method: 'POST', path: '/chat.postMessage', description: 'Send message'}]}),
      ],
    });

    expect(result.systemPrompt).toContain('Connection: stripe');
    expect(result.systemPrompt).toContain('Connection: slack');
    expect(result.systemPrompt).toContain('POST /chat.postMessage');
  });

  // -------------------------------------------------------------------------
  // 5. Skills
  // -------------------------------------------------------------------------

  it('renders skills with trigger and body', () => {
    const result = compileContext({
      name: 'Agent',
      skills: [makeSkill()],
    });
    const prompt = result.systemPrompt;

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('### revenue-report');
    expect(prompt).toContain('**When to activate:** When the user asks about revenue');
    expect(prompt).toContain('Generate a monthly revenue report');
    expect(prompt).toContain('Step 1: Query /v1/charges');
  });

  it('renders skill without trigger or body', () => {
    const result = compileContext({
      name: 'Agent',
      skills: [{name: 'simple', description: 'A simple skill'}],
    });

    expect(result.systemPrompt).toContain('### simple');
    expect(result.systemPrompt).toContain('A simple skill');
    expect(result.systemPrompt).not.toContain('When to activate');
  });

  // -------------------------------------------------------------------------
  // 6. Knowledge
  // -------------------------------------------------------------------------

  it('renders knowledge docs with title and body', () => {
    const result = compileContext({
      name: 'Agent',
      knowledge: [makeKnowledge()],
    });

    expect(result.systemPrompt).toContain('## Knowledge Base');
    expect(result.systemPrompt).toContain('### Formatting Rules');
    expect(result.systemPrompt).toContain('Always use markdown tables');
  });

  it('falls back to name when title is missing', () => {
    const result = compileContext({
      name: 'Agent',
      knowledge: [{name: 'rules', body: 'Some rules here.'}],
    });

    expect(result.systemPrompt).toContain('### rules');
    expect(result.systemPrompt).toContain('Some rules here.');
  });

  // -------------------------------------------------------------------------
  // 7. Store schemas
  // -------------------------------------------------------------------------

  it('renders store schemas as tables', () => {
    const result = compileContext({
      name: 'Agent',
      stores: [makeStore()],
    });
    const prompt = result.systemPrompt;

    expect(prompt).toContain('## Data Stores');
    expect(prompt).toContain('### deals');
    expect(prompt).toContain('Entity: Deal (key: `{company}_{quarter}`)');
    expect(prompt).toContain('| Field | Type |');
    expect(prompt).toContain('| company | string |');
    expect(prompt).toContain('| amount | number |');
    expect(prompt).toContain('| stage | lead | qualified | closed |');
    expect(prompt).toContain('| contacts | string[] |');
    expect(prompt).toContain('| closedAt | datetime | null |');
    expect(prompt).toContain('query_store');
  });

  it('renders multiple stores', () => {
    const result = compileContext({
      name: 'Agent',
      stores: [
        makeStore(),
        makeStore({
          name: 'contacts',
          entity: {name: 'Contact', key: '{email}', schema: {email: {type: 'string'}, active: {type: 'boolean'}}},
        }),
      ],
    });

    expect(result.systemPrompt).toContain('### deals');
    expect(result.systemPrompt).toContain('### contacts');
    expect(result.systemPrompt).toContain('| email | string |');
  });

  it('renders ref fields with store name', () => {
    const result = compileContext({
      name: 'Agent',
      stores: [makeStore({
        name: 'activities',
        entity: {
          name: 'Activity',
          key: '{id}',
          schema: {dealRef: {type: 'ref', store: 'deals'}},
        },
      })],
    });

    expect(result.systemPrompt).toContain('| dealRef | ref → deals |');
  });

  // -------------------------------------------------------------------------
  // 8. Field guidance
  // -------------------------------------------------------------------------

  it('generates field guidance from connection access configs', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [makeConnection({
        fieldRestrictions: [
          {entity: 'Customer', field: 'tax_id', policy: 'never_retrieve', reason: 'PII'},
          {entity: 'Customer', field: 'email', policy: 'retrieve_but_redact'},
          {entity: 'Invoice', field: 'internal_notes', policy: 'role_gated', allowedRoles: ['admin']},
        ],
      })],
    });
    const prompt = result.systemPrompt;

    expect(prompt).toContain('## Field Access Restrictions');
    expect(prompt).toContain('Do not request: Customer.tax_id (PII)');
    expect(prompt).toContain('Will be redacted: Customer.email');
    // role_gated fields are always denied in OSS runtime (no role system)
    expect(prompt).toContain('Do not request: Invoice.internal_notes');
  });

  it('omits field guidance section when no restrictions', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [makeConnection({fieldRestrictions: undefined})],
    });

    expect(result.systemPrompt).not.toContain('Field Access Restrictions');
  });

  // -------------------------------------------------------------------------
  // 9. Scope labels
  // -------------------------------------------------------------------------

  it('omits scope labels in OSS runtime (no role system)', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [makeConnection({
        rowScoping: {
          Customer: {
            admin: {type: 'all', label: 'all customers'},
            sales_rep: {type: 'team', label: 'your team\'s customers'},
          },
        },
      })],
    });

    // Without a role system, scope labels are never resolved
    expect(result.systemPrompt).not.toContain('## Data Scope');
  });

  // -------------------------------------------------------------------------
  // 10. Alternative lookups
  // -------------------------------------------------------------------------

  it('generates alternative lookup guidance', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [makeConnection({
        alternativeLookups: [
          {restrictedField: 'Customer.tax_id', alternativeEndpoint: 'GET /v1/tax/ids', description: 'Tax ID lookup endpoint'},
        ],
      })],
    });

    expect(result.systemPrompt).toContain('Instead of Customer.tax_id, use GET /v1/tax/ids — Tax ID lookup endpoint');
  });

  // -------------------------------------------------------------------------
  // 11. basePrompt override
  // -------------------------------------------------------------------------

  it('returns basePrompt directly without compiling', () => {
    const result = compileContext({
      name: 'Agent',
      description: 'Should not appear',
      basePrompt: 'You are a custom agent. Follow these rules.',
      connections: [makeConnection()],
      skills: [makeSkill()],
    });

    expect(result.source).toBe('base_prompt_override');
    expect(result.systemPrompt).toBe('You are a custom agent. Follow these rules.');
    expect(result.systemPrompt).not.toContain('Should not appear');
    expect(result.systemPrompt).not.toContain('stripe');
  });

  // -------------------------------------------------------------------------
  // 12. Contributions
  // -------------------------------------------------------------------------

  it('returns per-section token contributions', () => {
    const input = makeFullInput();
    const result = compileContext(input);

    expect(result.contributions.length).toBeGreaterThan(0);

    const categories = result.contributions.map((c) => c.category);
    expect(categories).toContain('system');
    expect(categories).toContain('connection');
    expect(categories).toContain('skill');
    expect(categories).toContain('knowledge');
    expect(categories).toContain('store');

    // Every contribution has a positive token count
    for (const c of result.contributions) {
      expect(c.tokens).toBeGreaterThan(0);
      expect(c.name).toBeTruthy();
    }
  });

  it('basePrompt override has single contribution', () => {
    const result = compileContext({name: 'Agent', basePrompt: 'Custom prompt.'});

    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0].name).toBe('Base prompt override');
  });

  // -------------------------------------------------------------------------
  // 13. Plan mode
  // -------------------------------------------------------------------------

  it('includes plan mode section when active', () => {
    const result = compileContext({name: 'Agent', planMode: true});

    expect(result.systemPrompt).toContain('## Planning Mode Active');
    expect(result.systemPrompt).toContain('Present your plan to the user');
  });

  it('includes approved plan when provided', () => {
    const result = compileContext({
      name: 'Agent',
      planMode: true,
      approvedPlan: '1. Query Stripe\n2. Update store',
    });

    expect(result.systemPrompt).toContain('## Approved Plan');
    expect(result.systemPrompt).toContain('1. Query Stripe');
  });

  // -------------------------------------------------------------------------
  // 14. Agent override
  // -------------------------------------------------------------------------

  it('includes agentOverride in prompt', () => {
    const result = compileContext({
      name: 'Agent',
      agentOverride: 'You specialize in data analysis.',
    });

    expect(result.systemPrompt).toContain('You specialize in data analysis.');
  });

  // -------------------------------------------------------------------------
  // 15. Empty inputs
  // -------------------------------------------------------------------------

  it('handles empty connections, skills, knowledge, stores gracefully', () => {
    const result = compileContext({
      name: 'Agent',
      connections: [],
      skills: [],
      knowledge: [],
      stores: [],
    });

    expect(result.systemPrompt).not.toContain('## Connected systems');
    expect(result.systemPrompt).not.toContain('## Skills');
    expect(result.systemPrompt).not.toContain('## Knowledge Base');
    expect(result.systemPrompt).not.toContain('## Data Stores');
  });

  it('handles undefined optional fields', () => {
    const result = compileContext({name: 'Minimal Agent'});

    expect(result.source).toBe('compiled');
    expect(result.systemPrompt).toContain('You are Minimal Agent.');
    expect(result.systemPrompt).not.toContain('undefined');
    expect(result.systemPrompt).not.toContain('null');
  });

  // -------------------------------------------------------------------------
  // 16. Automation context
  // -------------------------------------------------------------------------

  it('includes automation context when provided', () => {
    const result = compileContext({
      name: 'Agent',
      automationContext: 'This is a scheduled daily sync. Write results to the deals store.',
    });

    expect(result.systemPrompt).toContain('## Automation Context');
    expect(result.systemPrompt).toContain('scheduled daily sync');
  });

  it('omits automation context section when not provided', () => {
    const result = compileContext({name: 'Agent'});

    expect(result.systemPrompt).not.toContain('## Automation Context');
  });

  // -------------------------------------------------------------------------
  // 17. Token budget warning
  // -------------------------------------------------------------------------

  it('emits warning when prompt exceeds maxSystemTokens', () => {
    const result = compileContext({
      name: 'Agent',
      maxSystemTokens: 10, // absurdly low
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('exceeds token budget');
  });

  it('no warning when prompt fits within maxSystemTokens', () => {
    const result = compileContext({
      name: 'Agent',
      maxSystemTokens: 100_000,
    });

    expect(result.warnings).toHaveLength(0);
  });

  it('no warnings when maxSystemTokens is not set', () => {
    const result = compileContext(makeFullInput());

    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 18. Store contributions use accurate per-store estimates
  // -------------------------------------------------------------------------

  it('store contributions do not include section header overhead', () => {
    const result = compileContext({
      name: 'Agent',
      stores: [makeStore()],
    });

    const storeContribution = result.contributions.find((c) => c.name === 'deals');
    expect(storeContribution).toBeDefined();
    // The contribution should not include "## Data Stores" header
    // A single store with 5 fields should be ~200-400 chars (~50-100 tokens)
    expect(storeContribution!.tokens).toBeLessThan(150);
    expect(storeContribution!.tokens).toBeGreaterThan(20);
  });
});
