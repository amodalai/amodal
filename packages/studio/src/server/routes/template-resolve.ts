/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/studio/template/:slug — resolves a slug to template
 * metadata (displayName, description, githubRepo, card). Used by
 * the admin agent's `resolve_template` custom tool to look up
 * what to install + render before kicking off a Path A walkthrough.
 *
 * Resolution order:
 *   1. Cloud registry: `${REGISTRY_URL}/api/templates/:slug`
 *   2. Local fixture (`template-fixture.ts`) — for local dev when
 *      the cloud registry isn't reachable or doesn't have the slug
 *
 * Returns 404 when neither source has the slug.
 */

import { Hono } from 'hono';

import { getRegistryUrl } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { getTemplateFixture, type TemplateFixture } from '../template-fixture.js';

const REGISTRY_TIMEOUT_MS = 5_000;

export const templateResolveRoutes = new Hono();

templateResolveRoutes.get('/api/studio/template/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!slug || slug.length === 0) {
    return c.json({ error: { code: 'BAD_SLUG', message: 'Slug is required' } }, 400);
  }

  // 1. Try the cloud registry first
  const fromRegistry = await tryRegistry(slug);
  if (fromRegistry) {
    return c.json(fromRegistry);
  }

  // 2. Fall back to the local fixture
  const fixture = getTemplateFixture(slug);
  if (fixture) {
    logger.info('template_resolve_fixture_hit', { slug });
    return c.json(fixture);
  }

  return c.json({ error: { code: 'NOT_FOUND', message: `No template registered for slug "${slug}"` } }, 404);
});

async function tryRegistry(slug: string): Promise<TemplateFixture | null> {
  const url = `${getRegistryUrl()}/api/templates/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing registry response
    const raw = (await res.json()) as Partial<TemplateFixture> & {
      // Platform-api `TemplateCatalogEntry` shape — different field names
      // than the local `TemplateFixture` ships, so we have to map them
      // when building the card payload below.
      name?: string;
      tagline?: string;
      cardImageUrl?: string;
      cardPlatforms?: string[];
      // Legacy fields some old clients / fixtures still emit; supported
      // as fallbacks but platform-api doesn't return these.
      platforms?: string[];
      thumbnailConversation?: Array<{role: 'user' | 'agent'; content: string}>;
    };
    if (typeof raw.slug !== 'string' || typeof raw.githubRepo !== 'string') return null;

    const displayName = raw.displayName ?? raw.name ?? raw.slug;
    return {
      slug: raw.slug,
      displayName,
      description: raw.description ?? '',
      githubRepo: raw.githubRepo,
      defaultBranch: raw.defaultBranch ?? 'main',
      card: raw.card ?? {
        // Title prefers the human-readable name, never the slug.
        title: displayName,
        // Tagline → marketplace tagline, falling back to the longer
        // description so the card never renders an empty subheading.
        tagline: raw.tagline ?? raw.description ?? '',
        // Platforms come from `cardPlatforms` on platform-api; legacy
        // `platforms` is kept as a fallback for older fixtures.
        platforms: raw.cardPlatforms ?? raw.platforms ?? [],
        // ThumbnailConversation stays empty when the registry doesn't
        // provide one — the inline card renders the image (when set)
        // or just the title + tagline + platforms.
        thumbnailConversation: raw.thumbnailConversation ?? [],
        ...(raw.cardImageUrl ? { imageUrl: raw.cardImageUrl } : {}),
      },
    };
  } catch (err: unknown) {
    logger.debug('template_resolve_registry_unreachable', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
