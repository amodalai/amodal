/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import type { AgentCard } from '@amodalai/types';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { fetchAgentCard } from './template-card-fetcher';
import { STUB_CATALOG_AGENTS } from './stub-catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  author: string;
  verified: boolean;
  category: string;
  githubRepo: string;
  defaultBranch: string;
  tags?: string[];
  featured?: boolean;
}

interface CatalogResponse {
  templates: CatalogEntry[];
}

/** A connection / skill row shown in the detail view. */
export interface DetailRow {
  name: string;
  desc: string;
}

/** A turn in the example-output preview shown on the detail page. */
export interface DetailPreviewTurn {
  role: 'user' | 'agent';
  text: string;
}

/**
 * Rich detail surfaced on the template detail page. Lazy-loaded from the
 * template repo's `template.json` for real catalog entries; stub catalog
 * ships it inline so local dev sees full detail without a registry.
 */
export interface CatalogAgentDetail {
  description: string;
  preview: DetailPreviewTurn[];
  connections: {
    required: DetailRow[];
    optional: DetailRow[];
  };
  skills: DetailRow[];
  /** First setup question — admin agent picks up from there once the chat opens. */
  setup: { q: string; choices: string[] };
}

/** A marketplace template enriched with its rendered card. Cardless templates are dropped. */
export interface CatalogAgent {
  slug: string;
  /** Marketplace category (Marketing, Support, Sales, Ops…). Drives the gallery tabs. */
  category: string;
  /** Free-form tags used by the search box. */
  tags: string[];
  /** GitHub repo + branch — needed to lazy-load `preview.json` from the detail page. */
  githubRepo: string;
  defaultBranch: string;
  /** True when the template is in the staff-curated featured set. Drives the "Popular" tab. */
  featured: boolean;
  /** Author handle ('@amodal' for first-party, '@some-author' for community). */
  author: string;
  /** True when the author is in the trusted-creator set; drives the blue checkmark. */
  verified: boolean;
  card: AgentCard;
  /** Optional rich detail (description, connections, skills, first setup question). */
  detail?: CatalogAgentDetail;
}

export interface UseTemplateCatalogResult {
  agents: CatalogAgent[];
  loading: boolean;
  /** Catalog fetch failure. Per-template card errors are silently dropped. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const CATALOG_TIMEOUT_MS = 5_000;

/**
 * Fetches the full published marketplace and resolves each template's
 * `card/card.json` from GitHub raw. Drives the create-flow picker and the
 * BrowsePage gallery. Templates without a curated card are silently
 * dropped — Phase 7 backfills cards for the rest.
 */
export function useTemplateCatalog(): UseTemplateCatalogResult {
  const { registryUrl } = useStudioConfig();
  const [state, setState] = useState<UseTemplateCatalogResult>({
    agents: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const catalogRes = await fetch(`${registryUrl}/api/templates`, {
          signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
        });
        if (!catalogRes.ok) {
          throw new Error(`Registry returned ${String(catalogRes.status)}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing registry response
        const catalog = (await catalogRes.json()) as CatalogResponse;

        const agents = await Promise.all(
          catalog.templates.map(async (entry) => {
            const card = await fetchAgentCard(entry.githubRepo, entry.defaultBranch);
            if (!card) return null;
            const result: CatalogAgent = {
              slug: entry.slug,
              category: entry.category,
              tags: entry.tags ?? [],
              githubRepo: entry.githubRepo,
              defaultBranch: entry.defaultBranch,
              featured: entry.featured === true,
              author: entry.author,
              verified: entry.verified,
              card,
            };
            return result;
          }),
        );

        if (!cancelled) {
          const resolved = agents.filter((a): a is CatalogAgent => a !== null);
          // Local-dev / first-run fallback: if the registry returned nothing
          // we surface a stub catalog so the picker still renders real-looking
          // cards. Drop `STUB_CATALOG_AGENTS` once production has live
          // templates and this branch will never hit.
          setState({
            agents: resolved.length > 0 ? resolved : [...STUB_CATALOG_AGENTS],
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          // Same fallback as above — when the catalog is unreachable, stub
          // in real-looking cards rather than leaving the picker empty.
          // Suppress the error banner when stubs are taking over: the picker
          // is showing valid cards, just not from the registry.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error normalization at module boundary
          const errorMessage = (err as Error).message ?? 'Failed to load template catalog';
          setState({
            agents: [...STUB_CATALOG_AGENTS],
            loading: false,
            error: STUB_CATALOG_AGENTS.length > 0 ? null : errorMessage,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [registryUrl]);

  return state;
}
