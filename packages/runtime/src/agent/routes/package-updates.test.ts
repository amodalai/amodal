/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {compareVersions} from './package-updates.js';

describe('compareVersions', () => {
  it('orders patch bumps numerically, not lexically', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.9', '1.2.10')).toBeLessThan(0);
  });

  it('treats missing components as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('returns 0 for identical versions', () => {
    expect(compareVersions('0.3.40', '0.3.40')).toBe(0);
  });

  it('orders prereleases lexically on the tail', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBeGreaterThan(0);
  });
});
