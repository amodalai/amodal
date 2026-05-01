/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useRepoState } from '../hooks/useRepoState';
import { CreateFlowPage } from './CreateFlowPage';
import { OverviewPage } from './OverviewPage';

/**
 * Index route guard: an empty repo (no `amodal.json`) gets the create
 * flow, a configured repo gets the agent overview. The probe (see
 * `useRepoState`) reads two signals from Studio's `/api/repo-state`:
 *
 *   - `hasAmodalJson` — file exists on disk
 *   - `setupInProgress` — a `setup_state` row is mid-flow (completedAt null)
 *
 * Routing rule: only flip to OverviewPage when `amodal.json` is on disk
 * AND no setup_state row is mid-flow. Otherwise stay on CreateFlowPage.
 *
 * Why both: `install_template` may vendor an `amodal.json` from the
 * cloned template before the user has finished walking the setup flow.
 * Without the `setupInProgress` gate, the page would transition to
 * the workspace mid-chat and trap the user out of their setup. The
 * `setup_state` row stays put until `commit_setup` runs, which gives
 * us a clean "setup is fully done" signal.
 */
export function IndexPage() {
  const { hasAmodalJson, setupInProgress, loading } = useRepoState({ polling: true });
  if (loading) return null;
  const setupDone = hasAmodalJson && !setupInProgress;
  return setupDone ? <OverviewPage /> : <CreateFlowPage />;
}
