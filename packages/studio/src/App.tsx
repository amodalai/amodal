/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, createContext, useContext } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import { StudioEventsProvider } from './contexts/StudioEventsContext';
import { router } from './router';

interface StudioConfig {
  agentName: string;
  runtimeUrl: string;
  agentId: string;
}

const StudioConfigContext = createContext<StudioConfig>({
  agentName: 'Agent',
  runtimeUrl: 'http://localhost:3847',
  agentId: 'default',
});

export function useStudioConfig(): StudioConfig {
  return useContext(StudioConfigContext);
}

export function App() {
  const [config, setConfig] = useState<StudioConfig | null>(null);

  useEffect(() => {
    fetch('/api/studio/config')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
      .then((r) => r.json() as Promise<StudioConfig>)
      .then(setConfig)
      .catch(() => {
        // Fallback to defaults if config endpoint not ready
        setConfig({
          agentName: 'Agent',
          runtimeUrl: 'http://localhost:3847',
          agentId: 'default',
        });
      });
  }, []);

  if (!config) return null; // Loading

  return (
    <StudioConfigContext.Provider value={config}>
      <ThemeProvider>
        <StudioEventsProvider>
          <RouterProvider router={router} />
        </StudioEventsProvider>
      </ThemeProvider>
    </StudioConfigContext.Provider>
  );
}
