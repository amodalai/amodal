/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';

import {
  parseSpecJson,
  parseAccessJson,
  parseConnection,
  parseSkill,
  parseKnowledge,
  parseAutomation,
  parseEval,
} from './parsers.js';
import type {RepoError} from './repo-types.js';

describe('parseSpecJson', () => {
  it('parses valid spec JSON', () => {
    const json = JSON.stringify({
      baseUrl: 'https://api.example.com',
      specUrl: 'https://api.example.com/openapi.json',
      format: 'openapi',
    });
    const spec = parseSpecJson(json);
    expect(spec.baseUrl).toBe('https://api.example.com');
    expect(spec.specUrl).toBe('https://api.example.com/openapi.json');
    expect(spec.format).toBe('openapi');
  });

  it('throws CONFIG_PARSE_FAILED for invalid JSON', () => {
    try {
      parseSpecJson('not json');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_PARSE_FAILED');
    }
  });

  it('throws CONFIG_VALIDATION_FAILED for schema errors', () => {
    try {
      parseSpecJson(JSON.stringify({baseUrl: 'x', format: 'invalid'}));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });
});

describe('parseAccessJson', () => {
  it('parses valid access JSON', () => {
    const json = JSON.stringify({
      endpoints: {
        'GET /deals': {returns: ['deal']},
        'PUT /deals/{id}': {returns: ['deal'], confirm: true},
      },
    });
    const access = parseAccessJson(json);
    expect(Object.keys(access.endpoints)).toHaveLength(2);
  });

  it('throws CONFIG_PARSE_FAILED for invalid JSON', () => {
    try {
      parseAccessJson('{invalid');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_PARSE_FAILED');
    }
  });

  it('throws CONFIG_VALIDATION_FAILED for missing endpoints', () => {
    try {
      parseAccessJson(JSON.stringify({}));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });
});

describe('parseConnection', () => {
  const validSpec = JSON.stringify({baseUrl: 'https://api.test.com', specUrl: 'https://api.test.com/spec', format: 'openapi'});
  const validAccess = JSON.stringify({endpoints: {'GET /test': {returns: ['item']}}});

  it('parses a connection with all files', () => {
    const conn = parseConnection(
      'test-api',
      {
        specJson: validSpec,
        accessJson: validAccess,
        surfaceMd: '### GET /test\nDescription.',
        entitiesMd: '# Entities\n\n### Item\nA thing.',
        rulesMd: '# Rules\n\n- Rule one.',
      },
      '/path/to/test-api',
    );
    expect(conn.name).toBe('test-api');
    expect(conn.spec.format).toBe('openapi');
    expect(conn.access.endpoints['GET /test']).toBeDefined();
    expect(conn.surface).toHaveLength(1);
    expect(conn.entities).toContain('Entities');
    expect(conn.rules).toContain('Rule one');
  });

  it('handles missing optional files', () => {
    const conn = parseConnection(
      'minimal',
      {specJson: validSpec, accessJson: validAccess},
      '/path/to/minimal',
    );
    expect(conn.surface).toEqual([]);
    expect(conn.entities).toBeUndefined();
    expect(conn.rules).toBeUndefined();
  });
});

describe('parseSkill', () => {
  it('parses heading-based format', () => {
    const content = `# Skill: Deal Advisor

Trigger: User asks about a specific deal.

## Behavior

You are a sales advisor.

## Constraints

- Always cite evidence.
`;
    const skill = parseSkill(content, 'skills/deal-advisor/SKILL.md');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('Deal Advisor');
    expect(skill!.trigger).toBe('User asks about a specific deal.');
    expect(skill!.body).toContain('## Behavior');
    expect(skill!.body).toContain('## Constraints');
  });

  it('parses frontmatter format', () => {
    const content = `---
name: Pipeline Analyst
description: Analyzes pipeline health
trigger: User asks about pipeline
---

Analyze the pipeline and provide insights.
`;
    const skill = parseSkill(content, 'skills/pipeline/SKILL.md');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('Pipeline Analyst');
    expect(skill!.description).toBe('Analyzes pipeline health');
    expect(skill!.trigger).toBe('User asks about pipeline');
    expect(skill!.body).toContain('Analyze the pipeline');
  });

  it('returns null for unrecognized format', () => {
    const content = 'Just some random text.';
    expect(parseSkill(content, 'test')).toBeNull();
  });

  it('returns null for invalid frontmatter', () => {
    const content = `---
: invalid yaml [
---

body text
`;
    expect(parseSkill(content, 'test')).toBeNull();
  });

  it('returns null for frontmatter with no name', () => {
    const content = `---
description: no name
---

body
`;
    expect(parseSkill(content, 'test')).toBeNull();
  });

  it('handles skill with no trigger', () => {
    const content = `# Skill: Simple Skill

## Behavior

Do something.
`;
    const skill = parseSkill(content, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('Simple Skill');
    expect(skill!.trigger).toBeUndefined();
  });

  it('extracts description between heading and first section', () => {
    const content = `# Skill: My Skill

This is the description text.
It can span multiple lines.

## Behavior

Body content here.
`;
    const skill = parseSkill(content, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.description).toContain('description text');
    expect(skill!.description).toContain('multiple lines');
  });
});

describe('parseKnowledge', () => {
  it('parses a knowledge document', () => {
    const content = `# Knowledge: Enterprise Rules

Enterprise deals have 2x staleness thresholds.

- Discovery: 14 days
- Proposal: 28 days
`;
    const doc = parseKnowledge(content, 'enterprise-rules', '/knowledge/enterprise-rules.md');
    expect(doc.name).toBe('enterprise-rules');
    expect(doc.title).toBe('Enterprise Rules');
    expect(doc.body).toContain('2x staleness');
    expect(doc.body).toContain('14 days');
  });

  it('handles document without Knowledge: prefix', () => {
    const content = `# Brand Voice

Be direct and actionable.
`;
    const doc = parseKnowledge(content, 'brand-voice', '/knowledge/brand-voice.md');
    expect(doc.title).toBe('Brand Voice');
    expect(doc.body).toContain('direct and actionable');
  });

  it('handles document without heading', () => {
    const content = 'Just some text.';
    const doc = parseKnowledge(content, 'raw', '/knowledge/raw.md');
    expect(doc.title).toBe('raw');
    expect(doc.body).toBe('Just some text.');
  });
});

describe('parseAutomation', () => {
  it('parses a JSON automation', () => {
    const content = JSON.stringify({
      title: 'Morning Brief',
      schedule: '0 7 * * *',
      prompt: 'Scan all active deals and recent activities.',
    });
    const auto = parseAutomation(content, 'morning_brief', '/automations/morning_brief.json');
    expect(auto.name).toBe('morning_brief');
    expect(auto.title).toBe('Morning Brief');
    expect(auto.schedule).toBe('0 7 * * *');
    expect(auto.trigger).toBe('cron');
    expect(auto.prompt).toContain('Scan all active deals');
  });

  it('parses a webhook automation', () => {
    const content = JSON.stringify({
      title: 'Handle Failed Charge',
      trigger: 'webhook',
      prompt: 'A charge just failed. Investigate.',
    });
    const auto = parseAutomation(content, 'charge_failed', '/automations/charge_failed.json');
    expect(auto.trigger).toBe('webhook');
    expect(auto.schedule).toBeUndefined();
  });

  it('defaults trigger to manual when no schedule', () => {
    const content = JSON.stringify({
      title: 'Ad-hoc Report',
      prompt: 'Generate a full financial report.',
    });
    const auto = parseAutomation(content, 'report', '/automations/report.json');
    expect(auto.trigger).toBe('manual');
    expect(auto.schedule).toBeUndefined();
  });

  it('defaults trigger to cron when schedule is present', () => {
    const content = JSON.stringify({
      title: 'Hourly Check',
      schedule: '0 * * * *',
      prompt: 'Check stuff.',
    });
    const auto = parseAutomation(content, 'hourly', '/automations/hourly.json');
    expect(auto.trigger).toBe('cron');
  });

  it('backward compat: parses legacy markdown format', () => {
    const content = `# Automation: Legacy Check

Schedule: 0 9 * * *

## Check

Run the legacy check.
`;
    const auto = parseAutomation(content, 'legacy', '/automations/legacy.md');
    expect(auto.name).toBe('legacy');
    expect(auto.title).toBe('Legacy Check');
    expect(auto.trigger).toBe('cron');
    expect(auto.prompt).toContain('Run the legacy check');
  });
});

describe('parseEval', () => {
  it('parses a full eval', () => {
    const content = `# Eval: Stale Enterprise Deal

A $150K enterprise deal in proposal stage with no activity for 20 days.

## Setup

Tenant: tenant_demo
Context: viewing deal page for deal_123

## Query

"What's going on with this deal?"

## Assertions

- Should NOT flag as stale (enterprise threshold is 28 days)
- Should flag champion non-responsiveness
- Should recommend contacting the decision maker
- Should not recommend discounting
`;
    const ev = parseEval(content, 'stale-enterprise', '/evals/stale-enterprise.md');
    expect(ev.name).toBe('stale-enterprise');
    expect(ev.title).toBe('Stale Enterprise Deal');
    expect(ev.description).toContain('$150K enterprise deal');
    expect(ev.setup.tenant).toBe('tenant_demo');
    expect(ev.setup.context).toBe('viewing deal page for deal_123');
    expect(ev.query).toBe("What's going on with this deal?");
    expect(ev.assertions).toHaveLength(4);
    expect(ev.assertions[0]).toEqual({
      text: 'Should NOT flag as stale (enterprise threshold is 28 days)',
      negated: true,
    });
    expect(ev.assertions[1].negated).toBe(false);
    expect(ev.assertions[3].negated).toBe(true);
  });

  it('handles eval without setup section', () => {
    const content = `# Eval: Simple Test

A simple test.

## Query

"Hello"

## Assertions

- Should respond with a greeting
`;
    const ev = parseEval(content, 'simple', '/evals/simple.md');
    expect(ev.setup.tenant).toBeUndefined();
    expect(ev.setup.context).toBeUndefined();
    expect(ev.query).toBe('Hello');
    expect(ev.assertions).toHaveLength(1);
  });

  it('handles query without quotes', () => {
    const content = `# Eval: No Quotes

Test.

## Query

What is happening?

## Assertions

- Should answer
`;
    const ev = parseEval(content, 'no-quotes', '/evals/no-quotes.md');
    expect(ev.query).toBe('What is happening?');
  });

  it('parses negated assertions correctly', () => {
    const content = `# Eval: Negation Test

Test.

## Query

"Test"

## Assertions

- Should NOT do bad thing
- Should not leak data
- Should do good thing
- Plan confidence: min 0.8
`;
    const ev = parseEval(content, 'negation', '/evals/negation.md');
    expect(ev.assertions[0].negated).toBe(true);
    expect(ev.assertions[1].negated).toBe(true);
    expect(ev.assertions[2].negated).toBe(false);
    expect(ev.assertions[3].negated).toBe(false);
  });
});
