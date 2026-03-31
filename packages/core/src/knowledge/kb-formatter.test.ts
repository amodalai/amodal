/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { formatKnowledgeBase } from './kb-formatter.js';
import type { KBDocument } from './kb-types.js';

function makeDoc(
  overrides: Partial<KBDocument> & Pick<KBDocument, 'title' | 'category' | 'body'>,
): KBDocument {
  return {
    id: 'doc-1',
    scope_type: 'application',
    scope_id: 'org-1',
    tags: [],
    status: 'active',
    created_by: 'admin',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('formatKnowledgeBase', () => {
  it('returns empty string when no documents at all', () => {
    expect(formatKnowledgeBase([])).toBe('');
  });

  it('formats app-only KB', () => {
    const appDocs = [
      makeDoc({
        title: 'API Docs',
        category: 'methodology',
        body: 'How the API works.',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    expect(result).toContain('# Application Knowledge');
    expect(result).toContain('## Methodology');
    expect(result).toContain('### API Docs');
    expect(result).toContain('How the API works.');
  });

  it('formats environment category', () => {
    const docs = [
      makeDoc({
        title: 'Zone C Details',
        category: 'incident_history',
        body: 'Zone C had a rogue sensor.',
      }),
    ];
    const result = formatKnowledgeBase(docs);
    expect(result).toContain('# Application Knowledge');
    expect(result).toContain('## Incident History');
    expect(result).toContain('### Zone C Details');
    expect(result).toContain('Zone C had a rogue sensor.');
  });

  it('groups documents by category', () => {
    const appDocs = [
      makeDoc({
        title: 'Expertise A',
        category: 'methodology',
        body: 'A.',
      }),
      makeDoc({
        id: 'doc-2',
        title: 'Risk B',
        category: 'patterns',
        body: 'B.',
      }),
      makeDoc({
        id: 'doc-3',
        title: 'Expertise C',
        category: 'methodology',
        body: 'C.',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    // Both expertise docs under same heading
    const expertiseIdx = result.indexOf('## Methodology');
    const riskIdx = result.indexOf('## Patterns');
    expect(expertiseIdx).toBeLessThan(riskIdx);
    // Both expertise titles present
    expect(result).toContain('### Expertise A');
    expect(result).toContain('### Expertise C');
  });

  it('omits empty categories', () => {
    const appDocs = [
      makeDoc({
        title: 'Only System Docs',
        category: 'system_docs',
        body: 'API stuff.',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    expect(result).not.toContain('## Methodology');
    expect(result).not.toContain('## Patterns');
    expect(result).not.toContain('## Team');
    expect(result).toContain('## System Documentation');
  });

  it('handles single document per category', () => {
    const docs = [
      makeDoc({
        title: 'Team Info',
        category: 'team',
        body: 'Night shift is 1 analyst.',
      }),
    ];
    const result = formatKnowledgeBase(docs);
    expect(result).toContain('## Team');
    expect(result).toContain('### Team Info');
    expect(result).toContain('Night shift is 1 analyst.');
  });

  it('handles multiple documents per category', () => {
    const appDocs = [
      makeDoc({
        title: 'First',
        category: 'methodology',
        body: 'First body.',
      }),
      makeDoc({
        id: 'doc-2',
        title: 'Second',
        category: 'methodology',
        body: 'Second body.',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    expect(result).toContain('### First');
    expect(result).toContain('### Second');
  });

  it('maintains correct category display order', () => {
    const appDocs = [
      makeDoc({
        id: 'doc-5',
        title: 'Procedures',
        category: 'response_procedures',
        body: 'p',
      }),
      makeDoc({
        id: 'doc-1',
        title: 'SysDocs',
        category: 'system_docs',
        body: 's',
      }),
      makeDoc({
        id: 'doc-3',
        title: 'Risk',
        category: 'patterns',
        body: 'r',
      }),
      makeDoc({
        id: 'doc-2',
        title: 'Expertise',
        category: 'methodology',
        body: 'e',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    const sysIdx = result.indexOf('## System Documentation');
    const expertIdx = result.indexOf('## Methodology');
    const riskIdx = result.indexOf('## Patterns');
    const procIdx = result.indexOf('## Response Procedures');
    expect(sysIdx).toBeLessThan(expertIdx);
    expect(expertIdx).toBeLessThan(riskIdx);
    expect(riskIdx).toBeLessThan(procIdx);
  });

  it('maintains correct category display order for all categories', () => {
    const docs = [
      makeDoc({
        id: 'doc-1',
        title: 'History',
        category: 'incident_history',
        body: 'h',
      }),
      makeDoc({
        id: 'doc-2',
        title: 'Env',
        category: 'environment',
        body: 'e',
      }),
      makeDoc({
        id: 'doc-3',
        title: 'Base',
        category: 'baselines',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-4',
        title: 'TeamDoc',
        category: 'team',
        body: 't',
      }),
    ];
    const result = formatKnowledgeBase(docs);
    const envIdx = result.indexOf('## Environment');
    const baseIdx = result.indexOf('## Baselines');
    const teamIdx = result.indexOf('## Team');
    const histIdx = result.indexOf('## Incident History');
    expect(envIdx).toBeLessThan(baseIdx);
    expect(baseIdx).toBeLessThan(teamIdx);
    expect(teamIdx).toBeLessThan(histIdx);
  });

  it('preserves multiline bodies', () => {
    const appDocs = [
      makeDoc({
        title: 'Multi',
        category: 'methodology',
        body: 'Line 1.\nLine 2.\nLine 3.',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    expect(result).toContain('Line 1.\nLine 2.\nLine 3.');
  });

  it('formats all category display names correctly', () => {
    const appDocs = [
      makeDoc({
        id: 'doc-1',
        title: 'S',
        category: 'system_docs',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-2',
        title: 'D',
        category: 'methodology',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-3',
        title: 'R',
        category: 'patterns',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-4',
        title: 'F',
        category: 'false_positives',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-5',
        title: 'P',
        category: 'response_procedures',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-6',
        title: 'E',
        category: 'environment',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-7',
        title: 'B',
        category: 'baselines',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-8',
        title: 'T',
        category: 'team',
        body: 'b',
      }),
      makeDoc({
        id: 'doc-9',
        title: 'I',
        category: 'incident_history',
        body: 'b',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    expect(result).toContain('## System Documentation');
    expect(result).toContain('## Methodology');
    expect(result).toContain('## Patterns');
    expect(result).toContain('## False Positive Patterns');
    expect(result).toContain('## Response Procedures');
    expect(result).toContain('## Environment');
    expect(result).toContain('## Baselines');
    expect(result).toContain('## Team');
    expect(result).toContain('## Incident History');
  });

  it('includes scope description', () => {
    const appDocs = [
      makeDoc({
        title: 'D',
        category: 'methodology',
        body: 'b',
      }),
    ];
    const result = formatKnowledgeBase(appDocs);
    expect(result).toContain(
      '(application-level domain expertise)',
    );
  });
});
