/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Navigate } from 'react-router-dom';
import { useRepoState } from '../hooks/useRepoState';
import { OverviewPage } from './OverviewPage';

/**
 * Index route: a configured repo gets the agent overview, an empty
 * repo redirects to the dedicated `./setup` route. Reads two signals
 * from Studio's `/api/repo-state`:
 *
 *   - `hasAmodalJson` — file exists on disk
 *   - `setupInProgress` — a `setup_state` row is mid-flow (completedAt null)
 *
 * Routing rule: only show OverviewPage when `amodal.json` is on disk
 * AND no setup_state row is mid-flow. Otherwise redirect to `./setup`,
 * which renders the create flow at its own URL.
 *
 * Why both signals: `install_template` may vendor an `amodal.json`
 * from the cloned template before the user has finished walking the
 * setup flow. Without the `setupInProgress` gate we'd flip to the
 * workspace mid-chat and trap the user out of their setup. The
 * `setup_state` row stays put until `commit_setup` runs, which gives
 * us the clean "fully done" signal.
 *
 * Why a separate `./setup` route (vs. rendering CreateFlowPage here):
 * once the user is on `./setup`, the polling probe doesn't run and
 * can't auto-flip them away mid-setup if some external state changes
 * (a stale `completed_at` timestamp, a previous run's `amodal.json`,
 * etc.). The transition out of setup is then driven by exactly one
 * thing: AdminChat's `setup_completed` SSE handler navigating to the
 * agent root after a real commit.
 */
export function IndexPage() {
  const { hasAmodalJson, setupInProgress, loading } = useRepoState({ polling: true });
  if (loading) return null;
  const setupDone = hasAmodalJson && !setupInProgress;
  if (!setupDone) return <Navigate to="setup" replace />;
  return <OverviewPage />;
}
