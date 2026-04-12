/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Swords } from 'lucide-react';

export default function ArenaPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Model Arena</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare model performance side-by-side on eval suites.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-16 text-center">
        <Swords className="h-10 w-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium text-foreground">Coming soon</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-sm">
          The Model Arena will let you run the same eval suite across multiple models
          and compare results in a head-to-head view.
        </p>
      </div>
    </div>
  );
}
