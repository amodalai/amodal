/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {Theme} from './index.js';

export const monochromeTheme: Theme = {
  name: 'monochrome',
  text: {
    primary: '#FFFFFF',
    secondary: '#A0A0A0',
    accent: '#FFFFFF',
    link: '#C0C0C0',
  },
  status: {
    success: '#FFFFFF',
    error: '#FFFFFF',
    warning: '#FFFFFF',
  },
  border: {
    default: '#808080',
    focused: '#FFFFFF',
  },
  code: {
    background: '#1A1A1A',
    keyword: '#FFFFFF',
    string: '#C0C0C0',
    comment: '#606060',
    number: '#D0D0D0',
    function: '#E0E0E0',
    operator: '#A0A0A0',
  },
  ui: {
    dim: '#606060',
    muted: '#303030',
  },
};
