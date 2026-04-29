/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PickerCard } from '@/components/PickerCard';
import { useTemplateCatalog, type CatalogAgent } from '../hooks/useTemplateCatalog';
import { cn } from '@/lib/utils';

const ALL_TAB = 'All';
const FIXED_CATEGORIES: readonly string[] = [ALL_TAB, 'Marketing', 'Sales', 'Support', 'Ops'];

export function BrowsePage() {
  const navigate = useNavigate();
  const { agentId = 'local' } = useParams<{ agentId: string }>();
  const { agents, loading, error } = useTemplateCatalog();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL_TAB);

  // Spec's fixed five tabs first, plus any extra categories the catalog
  // surfaces (e.g. a community-published "Reporting" template).
  const categories = useMemo(() => {
    const seen = new Set<string>(FIXED_CATEGORIES);
    const extras: string[] = [];
    for (const a of agents) {
      if (!seen.has(a.category)) {
        seen.add(a.category);
        extras.push(a.category);
      }
    }
    return [...FIXED_CATEGORIES, ...extras];
  }, [agents]);

  const filtered = useMemo(() => filterAgents(agents, category, query), [agents, category, query]);

  const handleCardClick = (slug: string): void => {
    void navigate(`/agents/${agentId}/browse/${slug}`);
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-3xl mx-auto w-full">
      <h1 className="text-xl font-semibold text-foreground tracking-tight">All agents</h1>

      <div className="flex items-center gap-2.5 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents..."
          className="flex-1 min-w-[220px] rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-foreground/30 transition-colors"
        />
        <CategoryPills categories={categories} selected={category} onSelect={setCategory} />
      </div>

      <CatalogGrid
        loading={loading}
        error={error}
        agents={filtered}
        totalCount={agents.length}
        onCardClick={handleCardClick}
      />
    </div>
  );
}

function CategoryPills({
  categories,
  selected,
  onSelect,
}: {
  categories: string[];
  selected: string;
  onSelect: (c: string) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {categories.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onSelect(c)}
          className={cn(
            'text-[12px] rounded-md px-3 py-1.5 transition-all',
            selected === c
              ? 'bg-card border border-border text-foreground font-semibold shadow-sm'
              : 'border border-transparent text-muted-foreground hover:text-foreground font-medium',
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function CatalogGrid({
  loading,
  error,
  agents,
  totalCount,
  onCardClick,
}: {
  loading: boolean;
  error: string | null;
  agents: CatalogAgent[];
  totalCount: number;
  onCardClick: (slug: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center border border-dashed border-border rounded-lg">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading agents…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-lg">
        Couldn&apos;t load agents. {error}
      </div>
    );
  }

  if (agents.length === 0) {
    const reason = totalCount === 0
      ? 'No agents available yet.'
      : 'No agents match your search.';
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        {reason}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {agents.map((a) => (
        <PickerCard
          key={a.slug}
          card={a.card}
          category={a.category}
          onClick={() => onCardClick(a.slug)}
        />
      ))}
    </div>
  );
}

/**
 * Free-text search runs over title, tagline, platforms, and tags. Plain
 * substring match — no fuzzy ranking — because the catalog is small enough
 * that prefix matches feel responsive.
 */
function filterAgents(agents: CatalogAgent[], category: string, query: string): CatalogAgent[] {
  const q = query.trim().toLowerCase();
  return agents.filter((a) => {
    if (category !== ALL_TAB && a.category !== category) return false;
    if (q === '') return true;
    const haystack = [
      a.card.title,
      a.card.tagline,
      ...a.card.platforms,
      ...a.tags,
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}
