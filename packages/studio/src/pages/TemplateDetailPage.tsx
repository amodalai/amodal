/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { AgentCardPreview } from '@amodalai/types';
import { AgentCard } from '@/components/AgentCard';
import { AdminChat } from '@/components/views/AdminChat';
import { useTemplateCatalog, type CatalogAgent } from '../hooks/useTemplateCatalog';
import { fetchAgentCardPreview } from '../hooks/template-card-fetcher';

/**
 * Template detail view — `/agents/:agentId/browse/:slug`.
 *
 * Two-column layout: expanded card + description on the left, admin chat on
 * the right. The chat is seeded with `Set me up with the "<title>" template.`
 * on first mount so the user lands mid-conversation. Phase 4 will replace
 * the seed string with a richer first config question once the admin agent
 * has a `show_preview` tool.
 */
export function TemplateDetailPage() {
  const { agentId = 'local', slug = '' } = useParams<{ agentId: string; slug: string }>();
  const { agents, loading: catalogLoading, error: catalogError } = useTemplateCatalog();
  const agent = agents.find((a) => a.slug === slug);

  const browsePath = `/agents/${agentId}/browse`;

  if (catalogLoading) {
    return <PageFrame backTo={browsePath}><LoadingState /></PageFrame>;
  }

  if (catalogError) {
    return (
      <PageFrame backTo={browsePath}>
        <ErrorState message={`Couldn't load templates. ${catalogError}`} />
      </PageFrame>
    );
  }

  if (!agent) {
    return (
      <PageFrame backTo={browsePath}>
        <ErrorState message={`Template "${slug}" was not found in the catalog.`} />
      </PageFrame>
    );
  }

  return (
    <PageFrame backTo={browsePath}>
      <DetailLayout agent={agent} />
    </PageFrame>
  );
}

function DetailLayout({ agent }: { agent: CatalogAgent }) {
  const [preview, setPreview] = useState<AgentCardPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  // Seed the admin chat once on mount with a setup intent. AdminChat listens
  // for `admin-chat-send` CustomEvents and posts the detail string as the
  // next user turn.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('admin-chat-send', {
        detail: `Set me up with the "${agent.card.title}" template.`,
      }),
    );
  }, [agent.card.title]);

  // Lazy-fetch preview.json. Falls back to the thumbnail card if missing.
  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    void fetchAgentCardPreview(agent.githubRepo, agent.defaultBranch).then((p) => {
      if (!cancelled) {
        setPreview(p);
        setPreviewLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agent.githubRepo, agent.defaultBranch]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6 py-6 max-w-6xl mx-auto w-full">
      <section className="flex flex-col gap-3">
        {previewLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center border border-dashed border-border rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading preview…
          </div>
        ) : (
          <AgentCard card={preview ?? agent.card} variant="expanded" />
        )}
      </section>

      <section className="border border-border rounded-lg overflow-hidden bg-card flex flex-col h-[680px]">
        <header className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Set up this agent</h2>
        </header>
        <div className="flex-1 min-h-0">
          <AdminChat compact={false} />
        </div>
      </section>
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
          Back to gallery
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
      Loading template…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="text-sm text-muted-foreground py-16 text-center">{message}</div>
  );
}
