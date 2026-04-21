/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AmodalProvider } from '@amodalai/react';
import '@amodalai/react/widget/style.css';
import { RuntimeProvider } from '@/contexts/RuntimeContext';
import { RuntimeEventsProvider } from '@/contexts/RuntimeEventsContext';
import { router } from '@/router';
import { useAuth } from '@/hooks/useAuth';
import type { AuthState } from '@/hooks/useAuth';
import { LoginPage } from '@/pages/LoginPage';

const RUNTIME_URL = window.location.origin;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Auth context — exposes token and status to all pages/hooks
const AuthContext = createContext<AuthState>({
  token: null,
  status: 'loading',
  getToken: undefined,
  login: async () => ({ ok: false, error: 'No auth context' }),
  retry: () => {},
});
export function useAuthContext(): AuthState { return useContext(AuthContext); }

function AppContent() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (auth.status === 'unauthenticated') {
    return <LoginPage login={auth.login} />;
  }

  return (
    <AuthContext.Provider value={auth}>
      <AmodalProvider runtimeUrl={RUNTIME_URL} getToken={auth.getToken}>
        <RuntimeEventsProvider runtimeUrl={RUNTIME_URL}>
          <RuntimeProvider runtimeUrl={RUNTIME_URL}>
            <RouterProvider router={router} />
          </RuntimeProvider>
        </RuntimeEventsProvider>
      </AmodalProvider>
    </AuthContext.Provider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
