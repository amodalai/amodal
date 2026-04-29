/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { OnboardingWizard } from './OnboardingWizard';

/**
 * Onboarding page for fresh repos. Renders a deterministic wizard
 * (gallery → clone → credentials → customize → summary) that doesn't
 * require an LLM. The admin chat panel is available for "Build custom"
 * and questions.
 */
export function OnboardingPage() {
  return (
    <div className="h-full overflow-y-auto">
      <OnboardingWizard />
    </div>
  );
}
