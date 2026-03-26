/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AmodalProvider } from '@amodalai/react';
import { RuntimeProvider } from '@/contexts/RuntimeContext';
import { router } from '@/router';

const RUNTIME_URL = window.location.origin;
const TENANT_ID = 'local';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AmodalProvider runtimeUrl={RUNTIME_URL} tenantId={TENANT_ID}>
        <RuntimeProvider runtimeUrl={RUNTIME_URL}>
          <RouterProvider router={router} />
        </RuntimeProvider>
      </AmodalProvider>
    </QueryClientProvider>
  );
}
