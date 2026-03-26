/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { amodalPlugin } from './vite-plugin-amodal';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `amodal-plugin-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(relPath: string, content: string) {
  const full = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('amodalPlugin', () => {
  it('creates a plugin with the correct name', () => {
    const plugin = amodalPlugin({ repoPath: tmpDir });
    expect(plugin.name).toBe('vite-plugin-amodal');
  });

  it('resolves virtual module IDs', () => {
    const plugin = amodalPlugin({ repoPath: tmpDir });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId('virtual:amodal-manifest')).toBe('\0virtual:amodal-manifest');
    expect(resolveId('virtual:amodal-pages')).toBe('\0virtual:amodal-pages');
    expect(resolveId('other-module')).toBeNull();
  });

  it('generates manifest with no pages or automations', () => {
    const plugin = amodalPlugin({ repoPath: tmpDir });
    const load = plugin.load as (id: string) => string | null;
    const result = load('\0virtual:amodal-manifest');
    expect(result).toContain('export const pages = []');
    expect(result).toContain('export const automations = []');
  });

  it('discovers automation JSON files', () => {
    createFile('automations/daily-digest.json', JSON.stringify({
      title: 'Daily Digest',
      schedule: '0 9 * * 1-5',
    }));
    createFile('automations/manual-check.json', JSON.stringify({
      title: 'Manual Check',
    }));

    const plugin = amodalPlugin({ repoPath: tmpDir });
    const load = plugin.load as (id: string) => string | null;
    const result = load('\0virtual:amodal-manifest');

    expect(result).toContain('"daily-digest"');
    expect(result).toContain('"Daily Digest"');
    expect(result).toContain('"cron"');
    expect(result).toContain('"Manual Check"');
    expect(result).toContain('"manual"');
  });

  it('discovers page files', () => {
    createFile('pages/ops-dashboard.jsx', `
export const page = {
  name: 'ops-dashboard',
  icon: 'monitor',
  description: 'Operations dashboard',
};

export default function OpsDashboard() {
  return <div>Ops</div>;
}
`);

    const plugin = amodalPlugin({ repoPath: tmpDir });
    const load = plugin.load as (id: string) => string | null;
    const manifest = load('\0virtual:amodal-manifest');
    expect(manifest).toContain('"ops-dashboard"');

    const pages = load('\0virtual:amodal-pages');
    expect(pages).toContain('ops_dashboard');
    expect(pages).toContain('ops-dashboard.jsx');
  });

  it('generates empty pages module when no pages exist', () => {
    const plugin = amodalPlugin({ repoPath: tmpDir });
    const load = plugin.load as (id: string) => string | null;
    const result = load('\0virtual:amodal-pages');
    expect(result).toContain('export default {}');
  });
});
