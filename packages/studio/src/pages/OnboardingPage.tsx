/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react';
import { AdminChat } from '@/components/views/AdminChat';

const ONBOARDING_SEED = 'This is a fresh agent repo with no connections or skills configured yet. Help me set up my agent — show me some templates to start from, or help me build something custom.';

/**
 * Full-screen admin chat for onboarding fresh repos. Seeds the
 * conversation so the admin agent's onboarding skill fires immediately
 * instead of waiting for user input.
 */
export function OnboardingPage() {
  const cleared = useRef(false);

  useEffect(() => {
    if (!cleared.current) {
      cleared.current = true;
      try { localStorage.removeItem('amodal-admin-chat-v2'); } catch { /* */ }
    }
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Set up your agent</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a template or describe what you need. The admin agent will configure everything.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <AdminChat compact={false} initialMessage={ONBOARDING_SEED} />
      </div>
    </div>
  );
}
