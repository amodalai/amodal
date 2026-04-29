/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext } from 'react';

export interface StudioConfig {
  agentName: string;
  runtimeUrl: string;
  agentId: string;
  /**
   * Public registry/marketplace API URL. Same value cloud and OSS — the
   * featured-agents row on the home screen reads from
   * `${registryUrl}/api/templates?featured=true`. Self-hosted instances
   * override via the REGISTRY_URL env var.
   */
  registryUrl: string;
}

export const StudioConfigContext = createContext<StudioConfig>({
  agentName: 'Agent',
  runtimeUrl: 'http://localhost:3847',
  agentId: 'default',
  registryUrl: 'https://api.amodalai.com',
});

export function useStudioConfig(): StudioConfig {
  return useContext(StudioConfigContext);
}
