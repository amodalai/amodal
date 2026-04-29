/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getAgentId, getAgentName, getRegistryUrl, getRuntimeUrl } from '../../lib/config.js';

export const configRoutes = new Hono();

configRoutes.get('/api/config', async (c) => c.json({
    agentName: getAgentName(),
    runtimeUrl: getRuntimeUrl(),
    agentId: getAgentId(),
    registryUrl: getRegistryUrl(),
  }));
