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
 */
export function IndexPage() {
  const { hasAmodalJson, loading } = useRepoState();
  if (loading) return null;
  return hasAmodalJson ? <OverviewPage /> : <CreateFlowPage />;
}
