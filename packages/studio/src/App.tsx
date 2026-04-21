/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import { StudioEventsProvider } from './contexts/StudioEventsContext';
import { StudioConfigContext } from './contexts/StudioConfigContext';
import type { StudioConfig } from './contexts/StudioConfigContext';
import { router } from './router';
import '@amodalai/react/widget/style.css';

interface AppProps {
  /**
   * Override the events provider. Defaults to StudioEventsProvider (SSE).
   * External deployments can pass their own provider (e.g. Pusher-based)
   * that implements the same StudioEventsContext contract.
   */
  eventsProvider?: ComponentType<{ children: ReactNode }>;
  /** Override the config endpoint URL. Defaults to '/api/config'. */
  configUrl?: string;
}

export function App({
  eventsProvider: EventsProvider = StudioEventsProvider,
  configUrl = '/api/config',
}: AppProps = {}) {
  const [config, setConfig] = useState<StudioConfig | null>(null);

  useEffect(() => {
    fetch(configUrl)
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
  }, [configUrl]);

  if (!config) return null;

  return (
    <StudioConfigContext.Provider value={config}>
      <ThemeProvider>
        <EventsProvider>
          <RouterProvider router={router} />
        </EventsProvider>
      </ThemeProvider>
    </StudioConfigContext.Provider>
  );
}
