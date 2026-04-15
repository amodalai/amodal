/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import { StudioEventsProvider } from './contexts/StudioEventsContext';
import { StudioConfigContext } from './contexts/StudioConfigContext';
import type { StudioConfig } from './contexts/StudioConfigContext';
import { router } from './router';

export function App() {
  const [config, setConfig] = useState<StudioConfig | null>(null);

  useEffect(() => {
    fetch('/api/studio/config')
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
      .then((r) => r.json() as Promise<StudioConfig>)
      .then(setConfig)
      .catch(() => {
        setConfig({
          agentName: 'Agent',
          runtimeUrl: 'http://localhost:3847',
          agentId: 'default',
        });
      });
  }, []);

  if (!config) return null;

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
