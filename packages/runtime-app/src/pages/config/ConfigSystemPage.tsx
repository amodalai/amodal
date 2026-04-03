/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';

interface SystemInfo {
  repoPath: string;
  nodeVersion: string;
  runtimeVersion: string;
  uptime: number;
  stores: { dataDir?: string; backend?: string } | null;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${String(mins)}m ${String(seconds % 60)}s`;
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h ${String(mins % 60)}m`;
}

export function ConfigSystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setInfo(data as SystemInfo);
        }
      })
      .catch(() => {});
  }, []);

  if (!info) return <div className="p-8 text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground mb-6">System</h1>

      <div className="space-y-4">
        <InfoRow icon={<Server className="h-4 w-4" />} label="Runtime Version" value={info.runtimeVersion} />
        <InfoRow icon={<Server className="h-4 w-4" />} label="Node.js" value={info.nodeVersion} />
        <InfoRow icon={<Server className="h-4 w-4" />} label="Uptime" value={formatUptime(info.uptime)} />
        <InfoRow icon={<Server className="h-4 w-4" />} label="Repo Path" value={info.repoPath} mono />
        {info.stores && (
          <InfoRow icon={<Server className="h-4 w-4" />} label="Store Backend" value={info.stores.backend ?? 'pglite'} />
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-lg px-4 py-3">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
      </div>
    </div>
  );
}
