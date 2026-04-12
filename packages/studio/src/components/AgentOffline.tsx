/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export function AgentOffline({ page }: { page: string }) {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground">Agent Offline</h2>
        <p className="mt-2 text-muted-foreground">
          The runtime is not reachable. The {page} page requires a running agent.
        </p>
      </div>
    </div>
  );
}
