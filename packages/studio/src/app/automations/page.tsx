/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import Link from 'next/link';
import { listAutomations } from '@/lib/automation-queries';
import { getAgentId } from '@/lib/route-helpers';
import { RunNowButton, ToggleButton } from '@/components/studio/AutomationActions';
import { Zap, Clock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

const AUTOMATION_DETAIL_PATH = '/automations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;

  const [minute, hour] = parts;

  // */N * * * * → every N minutes
  if (minute?.startsWith('*/')) {
    const n = minute.slice(2);
    return `Every ${n} min`;
  }

  // N * * * * → every hour
  if (minute !== undefined && /^\d+$/.test(minute) && hour === '*') {
    return 'Every hour';
  }

  // M H * * * → daily
  if (minute !== undefined && /^\d+$/.test(minute) && hour !== undefined && /^\d+$/.test(hour)) {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  return schedule;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const agentId = getAgentId();
  const automations = await listAutomations(agentId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Automations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scheduled tasks that run your agent on a timer.
          </p>
        </div>
      </div>

      {automations.length === 0 ? (
        <div className="text-center py-16">
          <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            No automations configured yet.
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            Add automations through the admin agent or API.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((auto) => (
            <div
              key={auto.name}
              className="flex items-center justify-between p-4 rounded-lg border border-border bg-card"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`${AUTOMATION_DETAIL_PATH}/${encodeURIComponent(auto.name)}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {auto.name}
                  </Link>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded-full ${
                      auto.enabled
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {auto.enabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {formatSchedule(auto.schedule)}
                  </span>
                  <span className="text-xs text-muted-foreground truncate max-w-xs">
                    {auto.message}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <RunNowButton name={auto.name} />
                <ToggleButton name={auto.name} enabled={auto.enabled} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
