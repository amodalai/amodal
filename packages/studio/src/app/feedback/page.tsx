/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { listFeedback, getFeedbackSummary } from '@/lib/feedback-queries';
import { getBackend } from '@/lib/startup';
import { FeedbackView } from './FeedbackView';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const backend = await getBackend();
  const workspace = await backend.getWorkspace();
  const agentId = workspace.agentId;

  const [entries, summary] = await Promise.all([
    listFeedback(agentId),
    getFeedbackSummary(agentId),
  ]);

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
      />
    </div>
  );
}
