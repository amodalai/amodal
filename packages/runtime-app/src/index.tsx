/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
