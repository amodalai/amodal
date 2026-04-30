/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useRepoState } from '../hooks/useRepoState';
import { CreateFlowPage } from './CreateFlowPage';
import { OverviewPage } from './OverviewPage';

/**
 * Index route guard: an empty repo (no `amodal.json`) gets the create flow,
 * a configured repo gets the agent overview (model pricing dashboard). The
 * probe is a single fetch to Studio's `/api/repo-state` endpoint — see
 * `useRepoState` for the fail-open behavior.
 *
 * `polling: true` (Phase E.7) keeps re-probing every 2s while
 * `hasAmodalJson` is false, so the page transitions from create-flow to
 * workspace-home automatically when commit_setup writes amodal.json
 * (regardless of who triggered it — agent's `request_complete_setup`,
 * the "Finish setup" button, or `init-repo`'s skip-onboarding write).
 * Polling stops once the file lands.
 */
export function IndexPage() {
  const { hasAmodalJson, loading } = useRepoState({ polling: true });
  if (loading) return null;
  return hasAmodalJson ? <OverviewPage /> : <CreateFlowPage />;
}
