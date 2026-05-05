/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Link, useParams } from 'react-router-dom';
import { AgentOffline } from '@/components/AgentOffline';
import { ConnectionConfigForm } from '@/components/ConnectionConfigForm';
import { useConnectionDetail } from '../hooks/useConnectionDetail';

/**
 * Per-connection configure page — `/agents/:agentId/connections/:packageName`.
 *
 * Reached by clicking a package's name from Getting Started or Secrets.
 * Body delegates to the shared `<ConnectionConfigForm>` (Phase H.5),
 * which is also composed by the in-chat `<ConnectionConfigModal>`.
 *
 * The page-only chrome lives here: back link, header (icon +
 * displayName + description + Configured pill), auth-type footer.
 * Saves go through `POST /api/secrets/:name` via the shared
 * `useConnectionDetail` hook; OAuth uses a same-tab redirect (the
 * page survives the navigation; the modal flow uses a popup
 * instead).
 */
export function ConnectionConfigPage() {
  const { packageName: encoded } = useParams<{ packageName: string }>();
  const packageName = decodeURIComponent(encoded ?? '');
  const { data, error, loading, saveSecret } = useConnectionDetail(packageName);

  if (error) return <AgentOffline page="connection" detail={error} />;
  if (loading || !data) return null;

  const fulfilled = data.envVars.length > 0 && data.envVars.every((v) => v.set);

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        to="../getting-started"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to getting started
      </Link>

      <header className="flex items-start gap-4">
        {data.icon ? (
          <img src={data.icon} alt="" className="w-12 h-12 rounded shrink-0" />
        ) : (
          <span className="w-12 h-12 rounded bg-muted shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">{data.displayName}</h1>
          <p className="text-[11px] font-mono text-muted-foreground truncate">{data.name}</p>
          {data.description && (
            <p className="text-sm text-muted-foreground mt-2">{data.description}</p>
          )}
        </div>
        {fulfilled && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded bg-emerald-500/10 whitespace-nowrap">
            ✓ Configured
          </span>
        )}
      </header>

      <ConnectionConfigForm data={data} saveSecret={saveSecret} />

      <div className="pt-4 border-t border-border text-xs text-muted-foreground">
        Auth type from <code className="font-mono">amodal.auth.type</code>:{' '}
        <span className="font-mono text-foreground">{data.authType}</span>
      </div>
    </div>
  );
}
