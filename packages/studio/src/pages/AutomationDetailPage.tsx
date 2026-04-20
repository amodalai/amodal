/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
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
// Types
// ---------------------------------------------------------------------------

interface Automation {
  name: string;
  schedule: string;
  message: string;
  enabled: boolean;
}

interface AutomationRun {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionId: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: string | null): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
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

export function AutomationDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(() => {
    if (!name) return;
    fetch(`/api/automations/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          throw new Error('Not found');
        }
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ automation: Automation; runs: AutomationRun[] }>;
      })
      .then((d) => {
        setAutomation(d.automation);
        setRuns(d.runs);
      })
      .catch(() => {
        // Error or not found
      })
      .finally(() => setLoaded(true));
  }, [name]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!name) return null;
  if (notFound) return <Navigate to={AUTOMATIONS_LIST_PATH} replace />;
  if (!loaded || !automation) return null;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          to={AUTOMATIONS_LIST_PATH}
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
            <AutomationLiveStatus name={name} onComplete={fetchData} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RunNowButton name={name} onComplete={fetchData} />
          <ToggleButton name={name} enabled={automation.enabled} onComplete={fetchData} />
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
