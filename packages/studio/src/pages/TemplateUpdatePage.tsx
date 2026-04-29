/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import type { AgentCard } from '@amodalai/types';
import { AgentCard as AgentCardRenderer } from '@/components/AgentCard';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { usePackageUpdates, type PackageUpdate } from '../hooks/usePackageUpdates';
import { parseCard } from '../hooks/template-card-fetcher';

/**
 * `/agents/:agentId/updates/:slug`
 *
 * Output-as-diff: shows the package's currently-installed `card/card.json`
 * (so the user remembers what they have) plus the version delta. "Update"
 * runs `npm install <pkg>@latest` via the runtime; the v1 cut doesn't fetch
 * the latest card snippet ahead of time — once the install lands, the
 * package's surface refreshes naturally.
 */
export function TemplateUpdatePage() {
  const { agentId = 'local', slug = '' } = useParams<{ agentId: string; slug: string }>();
  const decodedName = decodeURIComponent(slug);
  const { runtimeUrl } = useStudioConfig();
  const { updates, loading: updatesLoading, error: updatesError } = usePackageUpdates();
  const update = updates.find((u) => u.name === decodedName);

  const homePath = `/agents/${agentId}`;

  if (updatesLoading) {
    return <PageFrame backTo={homePath}><LoadingState /></PageFrame>;
  }
  if (updatesError) {
    return (
      <PageFrame backTo={homePath}>
        <ErrorState message={`Couldn't load updates. ${updatesError}`} />
      </PageFrame>
    );
  }
  if (!update) {
    return (
      <PageFrame backTo={homePath}>
        <ErrorState message={`No update info for "${decodedName}". The package may not be installed.`} />
      </PageFrame>
    );
  }

  return (
    <PageFrame backTo={homePath}>
      <UpdateBody update={update} runtimeUrl={runtimeUrl} />
    </PageFrame>
  );
}

function UpdateBody({ update, runtimeUrl }: { update: PackageUpdate; runtimeUrl: string }) {
  const [card, setCard] = useState<AgentCard | null>(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCardLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `${runtimeUrl}/api/package-card?name=${encodeURIComponent(update.name)}`,
          { signal: AbortSignal.timeout(5_000) },
        );
        if (!res.ok) {
          if (!cancelled) setCard(null);
          return;
        }
        const raw: unknown = await res.json();
        if (!cancelled) setCard(parseCard(raw));
      } catch {
        if (!cancelled) setCard(null);
      } finally {
        if (!cancelled) setCardLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtimeUrl, update.name]);

  const onUpdate = async (): Promise<void> => {
    setInstalling(true);
    setInstallResult(null);
    try {
      const res = await fetch(`${runtimeUrl}/api/package-updates/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: update.name }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: runtime error response
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        setInstallResult(`Install failed: ${err.message ?? `HTTP ${String(res.status)}`}`);
        return;
      }
      setInstallResult('Update installed. Reload Studio to see the changes.');
    } catch (err) {
      setInstallResult(`Install failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-4xl mx-auto w-full">
      <header className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-primary shrink-0 mt-1" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">Update available</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{update.name}</p>
        </div>
      </header>

      <section className="bg-card border border-border rounded-lg p-4 flex items-center gap-4">
        <VersionTag label="Installed" value={update.installed ?? '—'} muted />
        <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 shrink-0" />
        <VersionTag label="Latest" value={update.latest ?? '—'} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">What you have today</h2>
        {cardLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center border border-dashed border-border rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading installed card…
          </div>
        ) : card ? (
          <AgentCardRenderer card={card} variant="thumbnail" />
        ) : (
          <p className="text-xs text-muted-foreground">
            This package doesn&apos;t ship a card snippet — nothing to preview here.
          </p>
        )}
      </section>

      <section className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { void onUpdate(); }}
          disabled={installing}
          className="px-4 py-2 rounded-lg bg-primary-solid text-white text-sm font-medium hover:bg-primary-solid/90 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {installing ? 'Installing…' : 'Update'}
        </button>
        {installResult && (
          <span className="text-xs text-muted-foreground">{installResult}</span>
        )}
      </section>
    </div>
  );
}

function VersionTag({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`text-sm font-mono ${muted ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
        {value}
      </span>
    </div>
  );
}

function PageFrame({ children, backTo }: { children: React.ReactNode; backTo: string }) {
  return (
    <div className="flex flex-col">
      <div className="px-6 py-4 border-b border-border">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </div>
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading update…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <div className="text-sm text-muted-foreground py-16 text-center">{message}</div>;
}
