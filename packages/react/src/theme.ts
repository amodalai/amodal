/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ChatTheme } from './types';

export const defaultTheme: ChatTheme = {
  primaryColor: '#1e40af',
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '14px',
  borderRadius: '8px',
  userBubbleColor: '#1e40af',
  agentBubbleColor: '#f3f4f6',
  toolCallColor: '#f9fafb',
  headerText: 'AI Assistant',
  placeholder: 'Type a message...',
  emptyStateText: 'Send a message to start a conversation.',
};

const themeToCSS: Record<keyof ChatTheme, string> = {
  primaryColor: '--pcw-primary',
  backgroundColor: '--pcw-bg',
  fontFamily: '--pcw-font',
  fontSize: '--pcw-font-size',
  borderRadius: '--pcw-radius',
  userBubbleColor: '--pcw-user-bubble',
  agentBubbleColor: '--pcw-agent-bubble',
  toolCallColor: '--pcw-tool-call-bg',
  headerText: '--pcw-header-text',
  placeholder: '--pcw-placeholder',
  emptyStateText: '--pcw-empty-state-text',
};

/**
 * Apply theme values as CSS custom properties on a DOM element.
 */
export function applyTheme(element: HTMLElement, theme: ChatTheme): void {
  const merged = { ...defaultTheme, ...theme };
  for (const [key, cssVar] of Object.entries(themeToCSS)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Known theme keys
    const value = merged[key as keyof ChatTheme];
    if (value !== undefined) {
      element.style.setProperty(cssVar, value);
    }
  }
}

/**
 * Get the merged theme with defaults filled in.
 */
export function mergeTheme(theme?: ChatTheme): Required<ChatTheme> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- All defaults provided
  return { ...defaultTheme, ...theme } as Required<ChatTheme>;
}
