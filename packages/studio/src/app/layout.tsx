/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import './globals.css';
import type { Metadata } from 'next';
import { StudioShell } from '@/components/StudioShell';
import { StudioEventsProvider } from '@/contexts/StudioEventsContext';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: 'Studio',
  description: 'Amodal agent management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const agentName = process.env['AGENT_NAME'] ?? 'Agent';
  const runtimeUrl = process.env['RUNTIME_URL'] ?? 'http://localhost:3847';

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider>
          <StudioEventsProvider>
            <StudioShell agentName={agentName} runtimeUrl={runtimeUrl}>
              {children}
            </StudioShell>
          </StudioEventsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
