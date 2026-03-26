/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Zap, Play, Square } from 'lucide-react';

interface AutomationInfo {
  name: string;
  schedule?: string;
  running: boolean;
  lastRun?: string;
  nextRun?: string;
}

/**
 * Automations status page — shows registered automations and their status.
 */
export function AutomationsPage() {
  const [automations, setAutomations] = useState<AutomationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAutomations() {
      try {
        const res = await fetch('/automations');
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const body = await res.json() as { automations: AutomationInfo[] };
          setAutomations(body.automations);
        }
      } catch {
        // Automations endpoint may not exist if none defined
      } finally {
        setIsLoading(false);
      }
    }
    void fetchAutomations();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Automations</h1>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : automations.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No automations defined. Add <code>.json</code> or <code>.md</code> files to <code>automations/</code>.
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map((auto) => (
            <div
              key={auto.name}
              className="border rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium text-sm">{auto.name}</div>
                  {auto.schedule && (
                    <div className="text-xs text-muted-foreground">{auto.schedule}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {auto.running ? (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <Play className="h-3 w-3" /> Running
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Square className="h-3 w-3" /> Idle
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
