/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Developer page loader.
 *
 * Loads pre-built page bundles from /pages-bundle/{name}.js via a script tag.
 * The page registers itself on window.__AMODAL_PAGES__[name].
 * React is available on window.React (set by the SPA entry point).
 */
export function DevPage() {
  const { pageName } = useParams<{ pageName: string }>();
  const [PageComponent, setPageComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pageName) return;
    setPageComponent(null);
    setError(false);

    // Check if already loaded
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global page registry
    const registry = (window as unknown as Record<string, unknown>)['__AMODAL_PAGES__'] as Record<string, React.ComponentType> | undefined;
    if (registry?.[pageName]) {
      setPageComponent(() => registry[pageName]);
      return;
    }

    // Load via script tag
    const script = document.createElement('script');
    script.src = `/pages-bundle/${pageName}.js`;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global page registry
      const reg = (window as unknown as Record<string, unknown>)['__AMODAL_PAGES__'] as Record<string, React.ComponentType> | undefined;
      if (reg?.[pageName]) {
        setPageComponent(() => reg[pageName]);
      } else {
        setError(true);
      }
    };
    script.onerror = () => setError(true);
    document.head.appendChild(script);
  }, [pageName]);

  if (error) {
    return <PageNotFound name={pageName ?? ''} />;
  }

  if (!PageComponent) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500 text-sm">Loading page...</div>;
  }

  return <PageComponent />;
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
