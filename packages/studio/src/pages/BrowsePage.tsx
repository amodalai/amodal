/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import { AgentCard } from '@/components/AgentCard';
import { useTemplateCatalog, type CatalogAgent } from '../hooks/useTemplateCatalog';
import { cn } from '@/lib/utils';

const ALL_TAB = 'All';

export function BrowsePage() {
  const navigate = useNavigate();
  const { agentId = 'local' } = useParams<{ agentId: string }>();
  const { agents, loading, error } = useTemplateCatalog();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL_TAB);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) set.add(a.category);
    return [ALL_TAB, ...Array.from(set).sort()];
  }, [agents]);

  const filtered = useMemo(() => filterAgents(agents, category, query), [agents, category, query]);

  const handleCardClick = (slug: string): void => {
    void navigate(`/agents/${agentId}/browse/${slug}`);
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-6xl mx-auto w-full">
      <header className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">Template gallery</h1>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        <CategoryTabs
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />
      </header>

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

function CategoryTabs({
  categories,
  selected,
  onSelect,
}: {
  categories: string[];
  selected: string;
  onSelect: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-border">
      {categories.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          className={cn(
            'px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            selected === c
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
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
        Loading templates…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-lg">
        Couldn&apos;t load templates. {error}
      </div>
    );
  }

  if (agents.length === 0) {
    const reason = totalCount === 0
      ? 'No templates available yet.'
      : 'No templates match your search.';
    return (
      <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-lg">
        {reason}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map((a) => (
        <AgentCard
          key={a.slug}
          card={a.card}
          variant="thumbnail"
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
