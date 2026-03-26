/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { setupServer } from 'msw/node';
import { chatHandlers } from './handlers';

export const server = setupServer(...chatHandlers);
