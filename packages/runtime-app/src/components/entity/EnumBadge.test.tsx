/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnumBadge } from './EnumBadge';

describe('EnumBadge', () => {
  it('renders the value text', () => {
    render(<EnumBadge value="P1" />);
    expect(screen.getByText('P1')).toBeDefined();
  });

  it('uses known color for severity values', () => {
    const { container } = render(<EnumBadge value="critical" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-red-100');
  });

  it('uses known color for healthy', () => {
    const { container } = render(<EnumBadge value="healthy" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-green-100');
  });

  it('uses hashed color for unknown values', () => {
    const { container } = render(<EnumBadge value="custom_value_xyz" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-');
  });

  it('applies custom className', () => {
    const { container } = render(<EnumBadge value="P1" className="ml-2" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('ml-2');
  });

  it('produces deterministic colors for same value', () => {
    const { container: c1 } = render(<EnumBadge value="test_value" />);
    const { container: c2 } = render(<EnumBadge value="test_value" />);
    expect((c1.firstChild as HTMLElement).className).toBe((c2.firstChild as HTMLElement).className);
  });
});
