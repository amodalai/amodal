/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FieldRenderer } from './FieldRenderer';
import type { StoreFieldDefinitionInfo } from '@amodalai/react';

function renderField(field: StoreFieldDefinitionInfo, value: unknown, mode: 'table' | 'detail' = 'table') {
  return render(
    <MemoryRouter>
      <FieldRenderer field={field} value={value} mode={mode} />
    </MemoryRouter>,
  );
}

describe('FieldRenderer', () => {
  it('renders null/undefined as dash', () => {
    renderField({ type: 'string' }, null);
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders string values', () => {
    renderField({ type: 'string' }, 'hello world');
    expect(screen.getByText('hello world')).toBeDefined();
  });

  it('truncates long strings in table mode', () => {
    const longStr = 'a'.repeat(100);
    renderField({ type: 'string' }, longStr, 'table');
    const el = screen.getByText(/^a+/);
    expect(el.textContent?.length).toBeLessThan(60);
  });

  it('renders full string in detail mode', () => {
    const longStr = 'a'.repeat(100);
    renderField({ type: 'string' }, longStr, 'detail');
    expect(screen.getByText(longStr)).toBeDefined();
  });

  it('renders number with locale formatting', () => {
    renderField({ type: 'number' }, 1234567);
    expect(screen.getByText('1,234,567')).toBeDefined();
  });

  it('renders percentage for 0-1 range numbers', () => {
    renderField({ type: 'number', min: 0, max: 1 }, 0.85);
    expect(screen.getByText('85%')).toBeDefined();
  });

  it('renders boolean as check icon', () => {
    const { container } = renderField({ type: 'boolean' }, true);
    expect(container.querySelector('svg')).toBeDefined();
  });

  it('renders enum as badge', () => {
    renderField({ type: 'enum', values: ['P1', 'P2'] }, 'P1');
    expect(screen.getByText('P1')).toBeDefined();
  });

  it('renders array count in table mode', () => {
    renderField({ type: 'array', item: { type: 'string' } }, ['a', 'b', 'c']);
    expect(screen.getByText('3 items')).toBeDefined();
  });

  it('renders array elements in detail mode', () => {
    renderField({ type: 'array', item: { type: 'string' } }, ['alpha', 'beta'], 'detail');
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.getByText('beta')).toBeDefined();
  });

  it('renders object as {...} in table mode', () => {
    renderField({ type: 'object', fields: { x: { type: 'string' } } }, { x: 'y' });
    expect(screen.getByText('{...}')).toBeDefined();
  });

  it('renders ref as link', () => {
    renderField({ type: 'ref', store: 'deals' }, 'deal_123');
    const link = screen.getByText('deal_123');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/entities/deals/deal_123');
  });

  it('renders datetime as relative time', () => {
    const recent = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
    renderField({ type: 'datetime' }, recent);
    expect(screen.getByText('2 min ago')).toBeDefined();
  });
});
