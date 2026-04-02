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
import { useAuth } from '@/hooks/useAuth';

const RUNTIME_URL = window.location.origin;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const { loading, error, getToken } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: '#71717a', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: '#dc2626', fontSize: 14 }}>{error}</div>
      </div>
    );
  }

  return (
    <AmodalProvider runtimeUrl={RUNTIME_URL} getToken={getToken}>
      <RuntimeProvider runtimeUrl={RUNTIME_URL}>
        <RouterProvider router={router} />
      </RuntimeProvider>
    </AmodalProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
