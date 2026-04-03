/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, KeyRound } from 'lucide-react';

interface EnvRef {
  name: string;
  connection: string;
  set: boolean;
}

export function ConfigSecretsPage() {
  const [envRefs, setEnvRefs] = useState<EnvRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'envRefs' in data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setEnvRefs((data as { envRefs: EnvRef[] }).envRefs);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setCount = envRefs.filter((e) => e.set).length;
  const missingCount = envRefs.filter((e) => !e.set).length;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground mb-2">Secrets</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Environment variables referenced by connection specs. Values are read from <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.env</code>.
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : envRefs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No environment variables referenced by connections.</div>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-4 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> {String(setCount)} set
            </span>
            {missingCount > 0 && (
              <span className="flex items-center gap-1 text-red-500 dark:text-red-400">
                <XCircle className="h-3.5 w-3.5" /> {String(missingCount)} missing
              </span>
            )}
          </div>

          <div className="space-y-2">
            {envRefs.map((env) => (
              <div
                key={`${env.connection}-${env.name}`}
                className="flex items-center justify-between border border-border rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <KeyRound className={`h-4 w-4 shrink-0 ${env.set ? 'text-emerald-500' : 'text-red-400'}`} />
                  <div>
                    <div className="text-sm font-mono text-foreground">{env.name}</div>
                    <div className="text-xs text-muted-foreground">Used by {env.connection}</div>
                  </div>
                </div>
                {env.set ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Set</span>
                ) : (
                  <span className="text-xs text-red-500 dark:text-red-400 font-medium">Missing</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
