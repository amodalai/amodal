/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AmodalRepo} from '../repo/repo-types.js';

/**
 * Configuration for a single chat or task session.
 */
export interface SessionConfig {
  repo: AmodalRepo;
  userRoles: string[];
  scopeLabels: Record<string, string>;
  fieldGuidance: string;
  alternativeLookupGuidance: string;
  planMode: boolean;
  approvedPlan?: string;
  isDelegated: boolean;
  sessionId: string;
}

/**
 * The fully compiled context ready for the LLM.
 */
export interface CompiledContext {
  systemPrompt: string;
  tokenUsage: TokenBudget;
  sections: ContextSection[];
}

/**
 * A single section of the compiled prompt.
 */
export interface ContextSection {
  name: string;
  content: string;
  tokens: number;
  /** Higher priority = more important, trimmed last. */
  priority: number;
  trimmed: boolean;
}

/**
 * Token budget tracking for the compiled context.
 */
export interface TokenBudget {
  total: number;
  used: number;
  remaining: number;
  sectionBreakdown: Record<string, number>;
}
