/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Local-dev fixture for `/api/studio/template/:slug`. Mirrors the
 * curated entries the cloud platform-api would otherwise return.
 * Used as a fallback when:
 *   - The cloud registry is unreachable, OR
 *   - Returns 404 for a slug we ship locally (typical local dev).
 *
 * The frontend picker (`useTemplateCatalog`) now reads catalog metadata
 * straight from platform-api with no local fallback; this fixture is
 * kept only for the backend resolve flow used by the admin agent's
 * `resolve_template` custom tool. Drop once the resolve flow is also
 * routed exclusively through platform-api.
 */

export interface TemplateFixture {
  slug: string;
  /** Human-readable name for show_preview and chat copy. */
  displayName: string;
  /** Long-form description shown on the detail page. */
  description: string;
  /** GitHub `<owner>/<repo>` — npm install supports this directly as a package spec. */
  githubRepo: string;
  defaultBranch: string;
  /** Card payload — feeds show_preview verbatim. */
  card: {
    title: string;
    tagline: string;
    platforms: string[];
    thumbnailConversation: Array<{role: 'user' | 'agent'; content: string}>;
    /** Marketplace card thumbnail (R2-hosted JPEG). Optional. */
    imageUrl?: string;
  };
}

const FIXTURES: TemplateFixture[] = [
  {
    slug: 'marketing-digest',
    displayName: 'Monday Marketing Digest',
    description:
      "Posts a metrics summary to your Slack channel every Monday morning. Pulls data from your analytics, social platforms, and ad accounts. Highlights what's working, what's not, and what needs attention.",
    githubRepo: 'whodatdev/template-marketing-operations-hub',
    defaultBranch: 'main',
    card: {
      title: 'Monday Marketing Digest',
      tagline: 'Weekly metrics → Slack',
      platforms: ['Google Analytics', 'LinkedIn', 'Instagram', 'Slack'],
      thumbnailConversation: [
        {
          role: 'agent',
          content:
            'Your weekly marketing digest is ready.\n\nWebsite: 12.4k sessions (+8%)\nLinkedIn: 2.1k impressions\nAd spend: $2,340 — ROAS 3.2x ✓',
        },
      ],
    },
  },
];

export function getTemplateFixture(slug: string): TemplateFixture | null {
  return FIXTURES.find((f) => f.slug === slug) ?? null;
}
