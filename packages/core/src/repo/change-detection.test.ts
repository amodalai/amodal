/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect } from 'vitest';
import { isContentOnlyChange } from './change-detection.js';

describe('isContentOnlyChange', () => {
  it('returns true for markdown under convention directories', () => {
    expect(
      isContentOnlyChange([
        'skills/pricing.md',
        'knowledge/faq.md',
        'agents/admin/SKILL.md',
      ])
    ).toBe(true);
  });

  it('returns true for JSON and YAML under convention directories', () => {
    expect(
      isContentOnlyChange([
        'connections/slack/spec.json',
        'stores/customers.json',
        'automations/daily-digest.yaml',
        'automations/scan.yml',
      ])
    ).toBe(true);
  });

  it('returns false when any path is a TypeScript file', () => {
    expect(
      isContentOnlyChange(['skills/pricing.md', 'tools/lookup/index.ts'])
    ).toBe(false);
  });

  it('returns false for anything under tools/, even tool.json', () => {
    // tools/ can contain TypeScript alongside tool.json; treat the whole
    // directory as code-triggering to keep the detection conservative.
    expect(isContentOnlyChange(['tools/lookup/tool.json'])).toBe(false);
  });

  it('returns false for anything under pages/', () => {
    expect(isContentOnlyChange(['pages/dashboard.tsx'])).toBe(false);
    expect(isContentOnlyChange(['pages/README.md'])).toBe(false);
  });

  it('returns false for root-level files like amodal.json or package.json', () => {
    expect(isContentOnlyChange(['amodal.json'])).toBe(false);
    expect(isContentOnlyChange(['package.json'])).toBe(false);
    expect(isContentOnlyChange(['README.md'])).toBe(false);
  });

  it('returns false for files under src/ or other non-convention directories', () => {
    expect(isContentOnlyChange(['src/index.ts'])).toBe(false);
    expect(isContentOnlyChange(['scripts/build.js'])).toBe(false);
    expect(isContentOnlyChange(['.github/workflows/ci.yml'])).toBe(false);
  });

  it('returns false if any single path fails the check', () => {
    expect(
      isContentOnlyChange([
        'skills/pricing.md',
        'knowledge/faq.md',
        'src/tools/lookup.ts',
      ])
    ).toBe(false);
  });

  it('tolerates leading slashes', () => {
    expect(isContentOnlyChange(['/skills/pricing.md'])).toBe(true);
  });

  it('matches extensions case-insensitively', () => {
    expect(isContentOnlyChange(['knowledge/FAQ.MD'])).toBe(true);
  });

  it('returns true for an empty change list (vacuous)', () => {
    // Callers should check input length before invoking the fast path if
    // they need to distinguish "no changes" from "all content changes."
    expect(isContentOnlyChange([])).toBe(true);
  });
});
