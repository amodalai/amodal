/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';

/**
 * Zod schema for a single conversation turn in an agent card.
 *
 * Mirrors {@link import('@amodalai/types').AgentCardTurn}. Validation lives in
 * core because zod is a runtime dep we don't want in the types package.
 */
export const AgentCardTurnSchema = z.object({
  role: z.enum(['user', 'agent']),
  content: z.string().min(1),
});

/**
 * Zod schema for `card/card.json`. Source of truth for the thumbnail card
 * shown on the home screen and inline in admin chat.
 */
export const AgentCardSchema = z.object({
  title: z.string().min(1),
  tagline: z.string().min(1),
  platforms: z.array(z.string().min(1)).default([]),
  thumbnailConversation: z.array(AgentCardTurnSchema).min(1),
  /**
   * Optional 3-4 line compressed sample (newline-separated) used by the
   * create-flow picker. When omitted, the picker derives a snippet from
   * the first agent turn of `thumbnailConversation`.
   */
  snippet: z.string().min(1).optional(),
  /** Lifetime install count, surfaced as social proof on picker cards. */
  uses: z.number().int().nonnegative().optional(),
});

/**
 * Zod schema for `card/preview.json`. The expanded preview shown when a user
 * clicks into a card.
 */
export const AgentCardPreviewSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  platforms: z.array(z.string().min(1)).default([]),
  conversation: z.array(AgentCardTurnSchema).min(1),
});
