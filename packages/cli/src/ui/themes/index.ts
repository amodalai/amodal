/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export interface Theme {
  name: string;
  text: {
    primary: string;
    secondary: string;
    accent: string;
    link: string;
  };
  status: {
    success: string;
    error: string;
    warning: string;
  };
  border: {
    default: string;
    focused: string;
  };
  code: {
    background: string;
    keyword: string;
    string: string;
    comment: string;
    number: string;
    function: string;
    operator: string;
  };
  ui: {
    dim: string;
    muted: string;
  };
}

import {lightTheme} from './light.js';
import {monochromeTheme} from './monochrome.js';

// Default dark theme (matches existing theme.ts)
export const defaultTheme: Theme = {
  name: 'default',
  text: {
    primary: '#E2E8F0',
    secondary: '#94A3B8',
    accent: '#2DD4BF',
    link: '#38BDF8',
  },
  status: {
    success: '#4ADE80',
    error: '#FB7185',
    warning: '#FBBF24',
  },
  border: {
    default: '#475569',
    focused: '#2DD4BF',
  },
  code: {
    background: '#1E293B',
    keyword: '#C084FC',
    string: '#4ADE80',
    comment: '#64748B',
    number: '#FB923C',
    function: '#38BDF8',
    operator: '#94A3B8',
  },
  ui: {
    dim: '#64748B',
    muted: '#334155',
  },
};

const themeRegistry = new Map<string, Theme>([
  ['default', defaultTheme],
  ['dark', defaultTheme],
  ['light', lightTheme],
  ['monochrome', monochromeTheme],
  ['mono', monochromeTheme],
]);

let currentThemeName = 'default';

export function getTheme(name: string): Theme | undefined {
  return themeRegistry.get(name);
}

export function setCurrentTheme(name: string): boolean {
  if (themeRegistry.has(name)) {
    currentThemeName = name;
    return true;
  }
  return false;
}

export function getCurrentThemeName(): string {
  return currentThemeName;
}

export function getAvailableThemes(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const [name, theme] of themeRegistry) {
    if (!seen.has(theme.name)) {
      seen.add(theme.name);
      result.push(name);
    }
  }
  return result;
}

export {lightTheme, monochromeTheme};
