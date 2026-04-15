/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { FeedbackView } from '@/components/views/FeedbackView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedbackEntry {
  id: string;
  rating: string;
  query: string;
  response: string;
  comment: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
}

interface FeedbackSummary {
  up: number;
  down: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FeedbackPage() {
  const { agentId } = useStudioConfig();
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary>({ up: 0, down: 0, total: 0 });
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(() => {
    const encodedId = encodeURIComponent(agentId);
    Promise.all([
      fetch(`/api/studio/feedback?agentId=${encodedId}`, {
        signal: AbortSignal.timeout(5_000),
      }).then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ entries: FeedbackEntry[] }>;
      }),
      fetch(`/api/studio/feedback/summary?agentId=${encodedId}`, {
        signal: AbortSignal.timeout(5_000),
      }).then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<FeedbackSummary>;
      }),
    ])
      .then(([entriesData, summaryData]) => {
        setEntries(entriesData.entries);
        setSummary(summaryData);
      })
      .catch(() => {
        // Leave defaults
      })
      .finally(() => setLoaded(true));
  }, [agentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!loaded) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          User feedback on agent responses. Review and track quality signals.
        </p>
      </div>

      <FeedbackView
        initialEntries={entries}
        initialSummary={summary}
        agentId={agentId}
        onRefresh={fetchData}
      />
    </div>
  );
}
