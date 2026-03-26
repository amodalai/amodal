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
 * Loads pages from the `virtual:amodal-pages` module (provided by the Vite plugin).
 * Matches the `:pageName` route param to the page's exported name.
 *
 * In dev mode, the Vite plugin resolves `virtual:amodal-pages` to the developer's
 * `pages/` directory. Changes to page files trigger HMR via the plugin's
 * handleHotUpdate handler.
 */
export function DevPage() {
  const { pageName } = useParams<{ pageName: string }>();

  const PageComponent = useMemo(() => {
    if (!pageName) return null;

    return lazy(async () => {
      try {
        // Dynamic import of the virtual module
        const pages = (await import('virtual:amodal-pages')).default;
        const Component = pages[pageName];

        if (!Component) {
          return { default: () => <PageNotFound name={pageName} /> };
        }

        return { default: Component };
      } catch {
        return { default: () => <PageNotFound name={pageName} /> };
      }
    });
  }, [pageName]);

  if (!PageComponent) {
    return <PageNotFound name="" />;
  }

  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground text-sm">Loading page...</div>}>
      <PageComponent />
    </Suspense>
  );
}

function PageNotFound({ name }: { name: string }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-2">Page Not Found</h1>
      <p className="text-muted-foreground">
        {name
          ? `No page named "${name}" found in pages/.`
          : 'No page specified.'}
      </p>
    </div>
  );
}
