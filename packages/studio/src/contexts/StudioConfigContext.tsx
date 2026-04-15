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
}

export const StudioConfigContext = createContext<StudioConfig>({
  agentName: 'Agent',
  runtimeUrl: 'http://localhost:3847',
  agentId: 'default',
});

export function useStudioConfig(): StudioConfig {
  return useContext(StudioConfigContext);
}
