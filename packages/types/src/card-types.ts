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
 * inline in admin chat. Source: `card/card.json` in the template package.
 */
export interface AgentCard {
  /** Display title (e.g. "Monday Marketing Digest"). */
  title: string;
  /** One-line "what it does" line under the title. */
  tagline: string;
  /** Connected platforms / services to surface as chips. */
  platforms: string[];
  /** 2-4 turn snippet rendered inside the card body. */
  thumbnailConversation: AgentCardTurn[];
  /**
   * Optional 3-4 line compressed sample of the agent's output, used by the
   * create-flow picker. Each line typically starts with an emoji and is
   * scannable in 2 seconds. Newline-separated. Renders in a tinted zone
   * above the title.
   */
  snippet?: string;
  /** Lifetime install count, surfaced as social proof on the picker card. */
  uses?: number;
  /** URL to a logo or icon image for display on the card. */
  icon?: string;
  /** Connection names for display (e.g. ["Typefully", "Dev.to", "GitHub"]). */
  connections?: string[];
  /** One-liner summaries per skill (e.g. ["Writes LinkedIn posts from blog drafts"]). */
  skillSummaries?: string[];
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
