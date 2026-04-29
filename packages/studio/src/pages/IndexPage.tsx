/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useAgentInventory } from '../hooks/useAgentInventory';
import { OverviewPage } from './OverviewPage';
import { OnboardingPage } from './OnboardingPage';

/**
 * Index route: a fresh repo (no connections, no skills) gets the
 * onboarding chat. A configured repo gets the dashboard.
 */
export function IndexPage() {
  const inventory = useAgentInventory();

  if (inventory.loading) return null;

  const isFresh =
    inventory.connections.length === 0 &&
    inventory.skills.length === 0 &&
    inventory.knowledge.length === 0;

  return isFresh ? <OnboardingPage /> : <OverviewPage />;
}
