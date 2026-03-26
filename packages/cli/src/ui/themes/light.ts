/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {Theme} from './index.js';

export const lightTheme: Theme = {
  name: 'light',
  text: {
    primary: '#1E293B', // slate-800
    secondary: '#475569', // slate-600
    accent: '#0D9488', // teal-600
    link: '#0284C7', // sky-600
  },
  status: {
    success: '#16A34A', // green-600
    error: '#DC2626', // red-600
    warning: '#D97706', // amber-600
  },
  border: {
    default: '#CBD5E1', // slate-300
    focused: '#0D9488', // teal-600
  },
  code: {
    background: '#F1F5F9', // slate-100
    keyword: '#7C3AED', // violet-600
    string: '#16A34A', // green-600
    comment: '#94A3B8', // slate-400
    number: '#EA580C', // orange-600
    function: '#0284C7', // sky-600
    operator: '#475569', // slate-600
  },
  ui: {
    dim: '#94A3B8', // slate-400
    muted: '#E2E8F0', // slate-200
  },
};
