/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { AgentOffline } from '@/components/AgentOffline';

/**
 * Getting Started — `/agents/:agentId/getting-started`.
 *
 * The home for first-run agent configuration. Surfaces the template's
 * connection slots, knowledge categories, and identity prompts so a user
 * coming off `template install` knows what to fill in before deploying.
 *
 * Today this is a stub — the full configurator (slot picker, per-package
 * configure flow, paste-credentials inputs) needs to be ported from the
 * cloud's old SetupPage. The route and nav entry are landed first so the
 * cloud can stop owning the URL.
 */
export function GettingStartedPage() {
  const { config, error, loading } = useRuntimeConfig();

  if (error) return <AgentOffline page="getting-started" detail={error} />;
  if (loading || !config) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Getting started</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up the connections, credentials, and identity this agent needs
          to run. Coming soon: an inline checklist for every slot the
          template declares.
        </p>
      </header>

      <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
        <p>
          The full setup flow (provider checklist, OAuth, paste-credentials)
          is still being moved from the cloud onboarding page into this tab.
          For now use the chat to talk to the admin agent — it can write
          secrets and update <code className="font-mono">amodal.json</code> for you.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Configured secrets</h2>
        {(config.envRefs ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No environment-variable references found in the agent&apos;s config.
          </p>
        ) : (
          <ul className="space-y-1">
            {(config.envRefs ?? []).map((ref) => (
              <li key={ref.name} className="text-xs font-mono text-muted-foreground">
                {ref.name}{ref.set ? ' ✓' : ' ⊘ unset'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
