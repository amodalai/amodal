/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { AdminChat } from '@/components/views/AdminChat';

/**
 * Full-screen admin chat for onboarding fresh repos. The admin agent's
 * onboarding skill fires automatically and walks the user through
 * template selection, cloning, and credential setup.
 */
export function OnboardingPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Set up your agent</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a template or describe what you need. The admin agent will configure everything.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <AdminChat />
      </div>
    </div>
  );
}
