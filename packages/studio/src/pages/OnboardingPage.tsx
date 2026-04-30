/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { OnboardingWizard } from './OnboardingWizard';

/**
 * Onboarding page for fresh repos. Fixed height container — the wizard
 * scrolls internally without pushing the page layout.
 */
export function OnboardingPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <OnboardingWizard />
    </div>
  );
}
