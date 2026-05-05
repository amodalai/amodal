/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// ---------------------------------------------------------------------------
// Agent card types
//
// Cards are how a template advertises itself in the gallery and inline in the
// admin chat. They show a short, curated conversation snippet — what the agent
// actually says — instead of a feature list. Cards live alongside the template
// at `card/card.json` (thumbnail) and `card/preview.json` (expanded preview).
// ---------------------------------------------------------------------------

/** A single turn in a curated agent-card conversation. */
export interface AgentCardTurn {
  role: 'user' | 'agent';
  content: string;
}

/**
 * Thumbnail card shown in the home screen popular row, gallery grid, and
 * inline in admin chat.
 *
 * Source: marketplace metadata served by platform-api at
 * `${registryUrl}/api/templates`. The author publishes a card image +
 * tagline + platforms via the marketplace publish UI; the OSS gallery
 * reads them straight off the catalog response.
 *
 * Legacy: templates without a marketplace listing can still ship a
 * `card/card.json` in their repo; the component renders a conversation
 * snippet fallback when `imageUrl` is absent. Kept optional so the
 * gradual migration off conversation-snippet cards doesn't break old
 * templates.
 */
export interface AgentCard {
  /** Display title (e.g. "Monday Marketing Digest"). */
  title: string;
  /** One-line "what it does" line under the title. */
  tagline: string;
  /** Connected platforms / services to surface as chips. */
  platforms: string[];
  /**
   * Marketplace card thumbnail URL (R2-hosted, 1200x800 JPEG).
   * Preferred when present; the component renders this and skips
   * the conversation snippet entirely.
   */
  imageUrl?: string;
  /**
   * Curated 2-4 turn agent-output snippet. Legacy path — used when
   * `imageUrl` is unset and the template ships a `card/card.json`
   * with the conversation shape. New templates should ship an image.
   */
  thumbnailConversation?: AgentCardTurn[];
  /**
   * Optional 3-4 line compressed sample of the agent's output, used by the
   * create-flow picker. Each line typically starts with an emoji and is
   * scannable in 2 seconds. Newline-separated. Renders in a tinted zone
   * above the title.
   */
  snippet?: string;
  /** Lifetime install count, surfaced as social proof on the picker card. */
  uses?: number;
}

/**
 * Expanded preview shown when a user clicks into a card. Has more turns than
 * the thumbnail. Source: `card/preview.json` in the template package.
 */
export interface AgentCardPreview {
  /** Same title as the thumbnail card. */
  title: string;
  /** Longer description shown beneath the conversation. */
  description: string;
  /** Connected platforms / services. */
  platforms: string[];
  /** Longer 4-8 turn snippet. */
  conversation: AgentCardTurn[];
}
