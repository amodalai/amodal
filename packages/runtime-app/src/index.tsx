/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';

// Expose React globally so esbuild-compiled pages can use it
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global assignment for page components
(window as unknown as Record<string, unknown>)['React'] = React;
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global assignment for page components
(window as unknown as Record<string, unknown>)['ReactDOM'] = ReactDOM;
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Page registry
(window as unknown as Record<string, unknown>)['__AMODAL_PAGES__'] = {};

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
