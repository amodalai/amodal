/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createRoot } from 'react-dom/client';
import { App } from './App';
import './globals.css';

const root = document.getElementById('app');
if (!root) throw new Error('Root element not found');
createRoot(root).render(<App />);
