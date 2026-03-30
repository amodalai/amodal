/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Suspense, lazy, useMemo } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Developer page loader.
 *
 * Two strategies:
 * 1. Pre-built bundles: loads from /pages-bundle/{name}.mjs (compiled by esbuild at startup)
 * 2. Vite virtual module: loads from virtual:amodal-pages (when Vite dev middleware is active)
 *
 * Strategy 1 is used when running outside the monorepo (npm install / npm link).
 * Strategy 2 is used when running inside the monorepo with Vite middleware.
 */
export function DevPage() {
  const { pageName } = useParams<{ pageName: string }>();

  const PageComponent = useMemo(() => {
    if (!pageName) return null;

    return lazy(async () => {
      // Strategy 1: Try loading from pre-built bundle
      try {
        const mod = await import(/* @vite-ignore */ `/pages-bundle/${pageName}.mjs`);
        const Component = mod.default;
        if (Component) return { default: Component };
      } catch {
        // Bundle not available — try virtual module
      }

      // Strategy 2: Try Vite virtual module (works inside monorepo)
      try {
        const pages = (await import('virtual:amodal-pages')).default;
        const Component = pages[pageName];
        if (Component) return { default: Component };
      } catch {
        // Virtual module not available
      }

      return { default: () => <PageNotFound name={pageName} /> };
    });
  }, [pageName]);

  if (!PageComponent) {
    return <PageNotFound name="" />;
  }

  return (
    <Suspense fallback={<div className="p-6 text-gray-500 dark:text-zinc-500 text-sm">Loading page...</div>}>
      <PageComponent />
    </Suspense>
  );
}

function PageNotFound({ name }: { name: string }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-2 text-gray-900 dark:text-zinc-200">Page Not Found</h1>
      <p className="text-gray-500 dark:text-zinc-500">
        {name
          ? `No page named "${name}" found in pages/.`
          : 'No page specified.'}
      </p>
    </div>
  );
}
