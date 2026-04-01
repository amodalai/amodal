/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';

interface ModelConfig {
  provider: string;
  model: string;
}

export function ConfigModelsPage() {
  const [models, setModels] = useState<Record<string, ModelConfig>>({});

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'models' in data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setModels((data as { models: Record<string, ModelConfig> }).models);
        }
      })
      .catch(() => {});
  }, []);

  const entries = Object.entries(models);

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200 mb-2">Models</h1>
      <p className="text-sm text-gray-500 dark:text-zinc-500 mb-6">
        Configured in <code className="text-xs bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">amodal.json</code> under <code className="text-xs bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">models</code>.
      </p>

      {entries.length === 0 ? (
        <div className="text-sm text-gray-400 dark:text-zinc-500">No models configured.</div>
      ) : (
        <div className="space-y-3">
          {entries.map(([key, m]) => (
            <div
              key={key}
              className="border border-gray-200 dark:border-zinc-800 rounded-xl p-5 bg-gray-50 dark:bg-zinc-900/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Cpu className="h-5 w-5 text-blue-600 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-zinc-200">
                        {m.model.replace(/-\d{8}$/, '')}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-blue-600/10 text-blue-800 dark:text-blue-400 font-medium">
                        {key}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                      Provider: <span className="font-medium text-gray-700 dark:text-zinc-300">{m.provider}</span>
                    </div>
                    <div className="text-xs text-gray-400 dark:text-zinc-600 font-mono mt-0.5">{m.model}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
