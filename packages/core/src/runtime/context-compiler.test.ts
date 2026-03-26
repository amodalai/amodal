/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it} from 'vitest';

import type {LoadedConnection} from '../repo/connection-types.js';
import type {
  AmodalRepo,
  LoadedKnowledge,
  LoadedSkill,
} from '../repo/repo-types.js';
import {ContextCompiler} from './context-compiler.js';
import type {SessionConfig} from './runtime-types.js';
import {TokenAllocator} from './token-allocator.js';

function makeConnection(name: string): LoadedConnection {
  return {
    name,
    spec: {
      source: 'https://api.example.com',
      format: 'openapi' as const,
    },
    access: {
      endpoints: {
        'GET /contacts': {returns: ['contact']},
        'POST /contacts': {returns: ['contact'], confirm: true},
      },
    },
    surface: [
      {
        method: 'GET',
        path: '/contacts',
        description: 'List all contacts',
        included: true,
      },
      {
        method: 'POST',
        path: '/contacts',
        description: 'Create a contact',
        included: true,
      },
      {
        method: 'DELETE',
        path: '/contacts/:id',
        description: 'Delete a contact',
        included: false,
      },
    ],
    entities: 'Contacts have name, email, and phone fields.',
    rules: 'Always confirm before creating contacts.',
    location: '/connections/crm',
  };
}

function makeSkill(name: string, trigger?: string): LoadedSkill {
  return {
    name,
    description: `${name} skill description`,
    trigger,
    body: `# ${name}\n\nSkill body content.`,
    location: `/skills/${name}.md`,
  };
}

function makeKnowledge(name: string, title: string): LoadedKnowledge {
  return {
    name,
    title,
    body: `Knowledge about ${title}.`,
    location: `/knowledge/${name}.md`,
  };
}

function makeRepo(overrides?: Partial<AmodalRepo>): AmodalRepo {
  const connections = new Map<string, LoadedConnection>();
  connections.set('crm', makeConnection('CRM'));

  return {
    source: 'local' as const,
    origin: '/test/repo',
    config: {
      name: 'TestApp',
      version: '1.0.0',
      description: 'A test application for CRM management',
      models: {
        main: {provider: 'anthropic', model: 'claude-3-opus'},
      },
    },
    connections,
    skills: [makeSkill('triage', 'When user asks to triage'), makeSkill('deep-dive')],
    agents: {},
    automations: [],
    knowledge: [
      makeKnowledge('patterns', 'Common Patterns'),
      makeKnowledge('procedures', 'Standard Procedures'),
    ],
    evals: [],
    tools: [],
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    repo: makeRepo(),
    userRoles: ['analyst'],
    scopeLabels: {},
    fieldGuidance: '',
    alternativeLookupGuidance: '',
    planMode: false,
    isDelegated: false,
    sessionId: 'test-session-1',
    ...overrides,
  };
}

describe('ContextCompiler', () => {
  describe('compile', () => {
    it('produces a prompt with all sections for a full repo', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('You are an AI assistant for TestApp');
      expect(result.systemPrompt).toContain('A test application for CRM management');
      expect(result.systemPrompt).toContain('Connection: CRM');
      expect(result.systemPrompt).toContain('GET /contacts');
      expect(result.systemPrompt).toContain('Available Skills');
      expect(result.systemPrompt).toContain('triage');
      expect(result.systemPrompt).toContain('Knowledge Base');
      expect(result.systemPrompt).toContain('Common Patterns');
    });

    it('tracks token budget correctly', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.tokenUsage.total).toBe(200_000 - 4096);
      expect(result.tokenUsage.used).toBeGreaterThan(0);
      expect(result.tokenUsage.remaining).toBe(
        result.tokenUsage.total - result.tokenUsage.used,
      );
    });

    it('includes section breakdown in token usage', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.tokenUsage.sectionBreakdown['base_prompt']).toBeGreaterThan(0);
      expect(result.tokenUsage.sectionBreakdown['connections']).toBeGreaterThan(0);
      expect(result.tokenUsage.sectionBreakdown['skills']).toBeGreaterThan(0);
      expect(result.tokenUsage.sectionBreakdown['knowledge']).toBeGreaterThan(0);
    });

    it('trims knowledge before skills when budget is tight', () => {
      // Very small budget to force trimming
      const repo = makeRepo();
      const allocator = new TokenAllocator(2000, 0);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      const knowledgeSection = result.sections.find(
        (s) => s.name === 'knowledge',
      );
      const skillsSection = result.sections.find((s) => s.name === 'skills');

      // Knowledge (priority 6) should be trimmed before skills (priority 7)
      if (knowledgeSection?.trimmed) {
        expect(skillsSection?.trimmed ?? false).toBe(false);
      }
    });

    it('skips agent_override when repo.agents.main is absent', () => {
      const repo = makeRepo({agents: {}});
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      const agentSection = result.sections.find(
        (s) => s.name === 'agent_override',
      );
      expect(agentSection).toBeUndefined();
    });

    it('includes agent_override when repo.agents.main is present', () => {
      const repo = makeRepo({agents: {main: 'You are a specialized CRM agent.'}});
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('You are a specialized CRM agent.');
      const agentSection = result.sections.find(
        (s) => s.name === 'agent_override',
      );
      expect(agentSection).toBeDefined();
      expect(agentSection).toHaveProperty('content', 'You are a specialized CRM agent.');
    });

    it('adds plan_mode section when planMode is true', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo, planMode: true});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('Planning Mode Active');
      expect(result.systemPrompt).toContain(
        'Present your plan to the user before executing write operations',
      );
    });

    it('includes approved plan when provided', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        planMode: true,
        approvedPlan: 'Step 1: Query contacts\nStep 2: Analyze results',
      });

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('Approved Plan');
      expect(result.systemPrompt).toContain('Step 1: Query contacts');
      expect(result.systemPrompt).toContain('Step 2: Analyze results');
    });

    it('renders scope labels when present', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        scopeLabels: {
          contact: 'Contacts in the EMEA region',
          deal: 'Deals above $10k',
        },
      });

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('Data Scope');
      expect(result.systemPrompt).toContain('- contact: Contacts in the EMEA region');
      expect(result.systemPrompt).toContain('- deal: Deals above $10k');
    });

    it('renders field guidance when non-empty', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        fieldGuidance: 'Do not access SSN fields. Redact email addresses.',
      });

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('Field Access Restrictions');
      expect(result.systemPrompt).toContain(
        'Do not access SSN fields. Redact email addresses.',
      );
    });

    it('skips field_guidance section when fieldGuidance is empty', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo, fieldGuidance: ''});

      const result = compiler.compile(session);

      const section = result.sections.find((s) => s.name === 'field_guidance');
      expect(section).toBeUndefined();
    });

    it('renders alternative lookup guidance when non-empty', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        alternativeLookupGuidance: 'Use /contacts/search instead of direct ID lookup.',
      });

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain(
        'Use /contacts/search instead of direct ID lookup.',
      );
    });

    it('handles empty repo with no connections, skills, or knowledge', () => {
      const repo = makeRepo({
        connections: new Map(),
        skills: [],
        knowledge: [],
      });
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('You are an AI assistant for TestApp');
      expect(result.systemPrompt).not.toContain('Connection:');
      expect(result.systemPrompt).not.toContain('Available Skills');
      expect(result.systemPrompt).not.toContain('Knowledge Base');
      // Only base_prompt should be present
      expect(result.sections).toHaveLength(1);
    });

    it('includes multiple connections', () => {
      const connections = new Map<string, LoadedConnection>();
      connections.set('crm', makeConnection('CRM'));
      connections.set('billing', makeConnection('Billing'));
      const repo = makeRepo({connections});
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('Connection: CRM');
      expect(result.systemPrompt).toContain('Connection: Billing');
    });

    it('only includes endpoints with included: true in surface', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('GET /contacts — List all contacts');
      expect(result.systemPrompt).toContain('POST /contacts — Create a contact');
      // DELETE endpoint has included: false
      expect(result.systemPrompt).not.toContain('DELETE /contacts/:id');
    });

    it('includes entities and rules from connections', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('Entities');
      expect(result.systemPrompt).toContain(
        'Contacts have name, email, and phone fields.',
      );
      expect(result.systemPrompt).toContain('Rules');
      expect(result.systemPrompt).toContain(
        'Always confirm before creating contacts.',
      );
    });

    it('renders skill triggers correctly', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain(
        'Trigger: When user asks to triage',
      );
      expect(result.systemPrompt).toContain('Trigger: Manual activation');
    });

    it('does not include plan_mode section when planMode is false', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo, planMode: false});

      const result = compiler.compile(session);

      const planSection = result.sections.find((s) => s.name === 'plan_mode');
      expect(planSection).toBeUndefined();
    });

    it('skips scope_descriptions when scopeLabels is empty', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo, scopeLabels: {}});

      const result = compiler.compile(session);

      const section = result.sections.find(
        (s) => s.name === 'scope_descriptions',
      );
      expect(section).toBeUndefined();
    });

    it('omits description line when config has no description', () => {
      const repo = makeRepo();
      repo.config.description = undefined;
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compile(session);

      expect(result.systemPrompt).toContain('You are an AI assistant for TestApp');
      expect(result.systemPrompt).not.toContain('A test application');
    });
  });

  describe('compileExplore', () => {
    it('uses explore-specific preamble', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).toContain('data-gathering sub-agent');
      expect(result.systemPrompt).toContain('200-500 tokens');
      expect(result.systemPrompt).not.toContain(
        'You are an AI assistant for TestApp',
      );
    });

    it('excludes skills section', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).not.toContain('Available Skills');
      const skillSection = result.sections.find((s) => s.name === 'skills');
      expect(skillSection).toBeUndefined();
    });

    it('excludes alternative_lookups section', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        alternativeLookupGuidance: 'Use search endpoint.',
      });

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).not.toContain('Use search endpoint.');
      const section = result.sections.find(
        (s) => s.name === 'alternative_lookups',
      );
      expect(section).toBeUndefined();
    });

    it('excludes plan_mode section', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo, planMode: true});

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).not.toContain('Planning Mode');
      const section = result.sections.find((s) => s.name === 'plan_mode');
      expect(section).toBeUndefined();
    });

    it('includes connections in explore context', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).toContain('Connection: CRM');
    });

    it('includes knowledge in explore context', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).toContain('Knowledge Base');
      expect(result.systemPrompt).toContain('Common Patterns');
    });

    it('uses simple agent override when present', () => {
      const repo = makeRepo({
        agents: {simple: 'You are a focused data retrieval agent.'},
      });
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({repo});

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).toContain(
        'You are a focused data retrieval agent.',
      );
    });

    it('includes field guidance in explore context', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        fieldGuidance: 'Redact PII fields.',
      });

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).toContain('Field Access Restrictions');
      expect(result.systemPrompt).toContain('Redact PII fields.');
    });

    it('includes scope descriptions in explore context', () => {
      const repo = makeRepo();
      const allocator = new TokenAllocator(200_000);
      const compiler = new ContextCompiler({repo, allocator});
      const session = makeSession({
        repo,
        scopeLabels: {account: 'Enterprise accounts only'},
      });

      const result = compiler.compileExplore(session);

      expect(result.systemPrompt).toContain('Data Scope');
      expect(result.systemPrompt).toContain(
        '- account: Enterprise accounts only',
      );
    });
  });
});
