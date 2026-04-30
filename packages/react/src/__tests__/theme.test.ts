/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { defaultTheme, applyTheme, mergeTheme } from '../theme';

describe('defaultTheme', () => {
  it('has all required properties', () => {
    expect(defaultTheme.primaryColor).toBeDefined();
    expect(defaultTheme.backgroundColor).toBeDefined();
    expect(defaultTheme.fontFamily).toBeDefined();
    expect(defaultTheme.fontSize).toBeDefined();
    expect(defaultTheme.borderRadius).toBeDefined();
    expect(defaultTheme.userBubbleColor).toBeDefined();
    expect(defaultTheme.agentBubbleColor).toBeDefined();
    expect(defaultTheme.toolCallColor).toBeDefined();
    expect(defaultTheme.headerText).toBeDefined();
    expect(defaultTheme.placeholder).toBeDefined();
  });

  it('includes verboseTools default', () => {
    expect(defaultTheme.verboseTools).toBe(false);
  });
});

describe('applyTheme', () => {
  it('does not set CSS property for boolean theme values', () => {
    const el = document.createElement('div');
    applyTheme(el, { verboseTools: true });
    expect(el.style.length).toBe(0);
  });

  it('sets CSS custom properties on element', () => {
    const el = document.createElement('div');
    applyTheme(el, { primaryColor: '#ff0000' });

    expect(el.style.getPropertyValue('--pcw-primary')).toBe('#ff0000');
  });

  it('applies all theme properties', () => {
    const el = document.createElement('div');
    applyTheme(el, {
      primaryColor: '#111',
      backgroundColor: '#222',
      fontFamily: 'monospace',
      fontSize: '16px',
      borderRadius: '4px',
      userBubbleColor: '#333',
      agentBubbleColor: '#444',
      toolCallColor: '#555',
    });

    expect(el.style.getPropertyValue('--pcw-primary')).toBe('#111');
    expect(el.style.getPropertyValue('--pcw-bg')).toBe('#222');
    expect(el.style.getPropertyValue('--pcw-font')).toBe('monospace');
    expect(el.style.getPropertyValue('--pcw-font-size')).toBe('16px');
    expect(el.style.getPropertyValue('--pcw-radius')).toBe('4px');
    expect(el.style.getPropertyValue('--pcw-user-bubble')).toBe('#333');
    expect(el.style.getPropertyValue('--pcw-agent-bubble')).toBe('#444');
    expect(el.style.getPropertyValue('--pcw-tool-call-bg')).toBe('#555');
  });

  it('does not set inline styles for unspecified properties', () => {
    const el = document.createElement('div');
    applyTheme(el, {});

    // Empty theme should not set any inline styles — CSS defaults handle it.
    // Setting defaults as inline styles would override .dark CSS rules.
    expect(el.style.getPropertyValue('--pcw-primary')).toBe('');
    expect(el.style.getPropertyValue('--pcw-bg')).toBe('');
  });
});

describe('mergeTheme', () => {
  it('returns defaults when no theme provided', () => {
    const result = mergeTheme();
    expect(result.primaryColor).toBe(defaultTheme.primaryColor);
    expect(result.headerText).toBe(defaultTheme.headerText);
  });

  it('overrides with provided values', () => {
    const result = mergeTheme({ primaryColor: '#ff0000', headerText: 'Custom' });
    expect(result.primaryColor).toBe('#ff0000');
    expect(result.headerText).toBe('Custom');
    expect(result.backgroundColor).toBe(defaultTheme.backgroundColor);
  });

  it('returns all properties', () => {
    const result = mergeTheme({});
    expect(result.primaryColor).toBeDefined();
    expect(result.backgroundColor).toBeDefined();
    expect(result.fontFamily).toBeDefined();
    expect(result.fontSize).toBeDefined();
    expect(result.borderRadius).toBeDefined();
    expect(result.userBubbleColor).toBeDefined();
    expect(result.agentBubbleColor).toBeDefined();
    expect(result.toolCallColor).toBeDefined();
    expect(result.headerText).toBeDefined();
    expect(result.placeholder).toBeDefined();
  });
});
