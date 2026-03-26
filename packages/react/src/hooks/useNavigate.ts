/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext, useCallback } from 'react';

/**
 * Navigation function type.
 * In the runtime app, this is backed by React Router's navigate.
 * In standalone/embedded usage, the host app provides the implementation.
 */
export type NavigateFn = (pageName: string, params?: Record<string, string>) => void;

/**
 * Context for providing a navigate function.
 * The runtime app sets this with React Router's navigate.
 * Standalone users can provide their own via NavigateProvider.
 */
export const NavigateContext = createContext<NavigateFn | null>(null);

/**
 * Navigate between pages in the runtime app.
 *
 * In the runtime app, navigates to the page route.
 * In standalone/embedded usage, calls the host-provided navigate function.
 * If no NavigateProvider is present, returns a no-op.
 *
 * @example
 * ```tsx
 * const navigate = useNavigate();
 * navigate('incident-detail', { correlationId: '123' });
 * ```
 */
export function useNavigate(): NavigateFn {
  const navigateFn = useContext(NavigateContext);

  const noopNavigate = useCallback((_pageName: string, _params?: Record<string, string>) => {
    // No-op when no NavigateProvider is present
  }, []);

  return navigateFn ?? noopNavigate;
}
