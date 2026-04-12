/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAutomation, listAutomationRuns } from '@/lib/automation-queries';
import { getAgentId } from '@/lib/route-helpers';
import { RunNowButton, ToggleButton } from '@/components/studio/AutomationActions';
import { AutomationLiveStatus } from '@/components/studio/AutomationLiveStatus';
import {
  ArrowLeft,
  Clock,
  MessageSquare,
  CheckCircle,
  XCircle,
  RotateCw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

const AUTOMATIONS_LIST_PATH = '/automations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'running':
      return <RotateCw className="w-4 h-4 text-amber-500 animate-spin" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'running':
      return 'Running';
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ name: string }>;
}

export default async function AutomationDetailPage({ params }: PageProps) {
  const { name } = await params;
  const agentId = getAgentId();

  const automation = await getAutomation(agentId, name);
  if (!automation) {
    notFound();
  }

  const runs = await listAutomationRuns(agentId, name);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href={AUTOMATIONS_LIST_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Automations
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{automation.name}</h1>
            <span
              className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${
                automation.enabled
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {automation.enabled ? 'Active' : 'Inactive'}
            </span>
            <AutomationLiveStatus name={name} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RunNowButton name={name} />
          <ToggleButton name={name} enabled={automation.enabled} />
        </div>
      </div>

      {/* Config details */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Clock className="w-3 h-3" />
              Schedule
            </div>
            <p className="text-sm text-foreground font-mono">{automation.schedule}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <MessageSquare className="w-3 h-3" />
              Message
            </div>
            <p className="text-sm text-foreground">{automation.message}</p>
          </div>
        </div>
      </div>

      {/* Run history */}
      <div>
        <h2 className="text-sm font-medium text-foreground mb-3">Run History</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No runs yet. Click &quot;Run Now&quot; to trigger the first run.
          </p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Started</th>
                  <th className="text-left px-4 py-2 font-medium">Completed</th>
                  <th className="text-left px-4 py-2 font-medium">Session</th>
                  <th className="text-left px-4 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        {statusIcon(run.status)}
                        <span className="text-foreground">{statusLabel(run.status)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatDate(run.startedAt)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatDate(run.completedAt)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                      {run.sessionId ? run.sessionId.slice(0, 8) : '—'}
                    </td>
                    <td className="px-4 py-2 text-red-500 text-xs truncate max-w-xs">
                      {run.error ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
