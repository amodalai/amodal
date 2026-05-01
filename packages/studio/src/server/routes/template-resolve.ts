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
      name?: string;
      tagline?: string;
      platforms?: string[];
      thumbnailConversation?: Array<{role: 'user' | 'agent'; content: string}>;
    };
    if (typeof raw.slug !== 'string' || typeof raw.githubRepo !== 'string') return null;
    return {
      slug: raw.slug,
      displayName: raw.displayName ?? raw.name ?? raw.slug,
      description: raw.description ?? '',
      githubRepo: raw.githubRepo,
      defaultBranch: raw.defaultBranch ?? 'main',
      card: raw.card ?? {
        title: raw.displayName ?? raw.slug,
        tagline: raw.tagline ?? '',
        platforms: raw.platforms ?? [],
        thumbnailConversation: raw.thumbnailConversation ?? [],
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
