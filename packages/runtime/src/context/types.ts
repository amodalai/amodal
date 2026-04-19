/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Types for the context compiler.
 *
 * These describe the raw inputs the compiler accepts — closely mirroring
 * the AgentBundle shape but only the fields relevant to prompt building.
 * The compiler is the single place that transforms these into a system prompt.
 */

import type {StoreFieldDefinition} from '@amodalai/types';

// ---------------------------------------------------------------------------
// Compiler inputs
// ---------------------------------------------------------------------------

/** A connection's API surface for prompt inclusion. */
export interface CompilerConnection {
  name: string;
  description?: string;
  endpoints: Array<{method: string; path: string; description: string}>;
  entities?: string;
  rules?: string;
  fieldRestrictions?: Array<{
    entity: string;
    field: string;
    policy: 'never_retrieve' | 'role_gated' | 'retrieve_but_redact';
    reason?: string;
    allowedRoles?: string[];
  }>;
  rowScoping?: Record<string, Record<string, {type: string; label?: string}>>;
  alternativeLookups?: Array<{
    restrictedField: string;
    alternativeEndpoint: string;
    description?: string;
  }>;
}

/** A skill loaded from the agent repo. */
export interface CompilerSkill {
  name: string;
  description: string;
  trigger?: string;
  body?: string;
}

/** A knowledge document loaded from the agent repo. */
export interface CompilerKnowledge {
  name: string;
  title?: string;
  body?: string;
}

/** A store definition for prompt inclusion. */
export interface CompilerStore {
  name: string;
  entity: {
    name: string;
    key: string;
    schema: Record<string, StoreFieldDefinition>;
  };
}

/** Full input to the context compiler. */
export interface CompilerInput {
  /** Agent name (required). */
  name: string;
  /** Agent description — what the agent is. */
  description?: string;
  /** Custom agent prompt override from agents/main.md. */
  agentOverride?: string;
  /** Custom base prompt — if set, skip compilation entirely. */
  basePrompt?: string;

  /** Connections with their API surfaces and access config. */
  connections?: CompilerConnection[];
  /** Skills loaded from skills/. */
  skills?: CompilerSkill[];
  /** Knowledge docs loaded from knowledge/. */
  knowledge?: CompilerKnowledge[];
  /** Store definitions loaded from stores/. */
  stores?: CompilerStore[];

  /** Agent memory content (loaded from agent_memory table). */
  memory?: string;

  /** Automation context — prompt and constraints when running as an automation. */
  automationContext?: string;

  /** Whether plan mode is active. */
  planMode?: boolean;
  /** Pre-approved plan for execution. */
  approvedPlan?: string;

  /** Token budget for the system prompt. If exceeded, a warning is emitted. */
  maxSystemTokens?: number;
}

/** Output from the context compiler. */
export interface CompilerOutput {
  /** The compiled system prompt string. */
  systemPrompt: string;
  /** Whether the prompt was compiled or came from a basePrompt override. */
  source: 'compiled' | 'base_prompt_override';
  /** Per-section token estimates (chars / 4) for the context inspector. */
  contributions: CompilerContribution[];
  /** Warnings emitted during compilation (e.g. token budget exceeded). */
  warnings: string[];
}

export interface CompilerContribution {
  name: string;
  category: 'system' | 'connection' | 'skill' | 'knowledge' | 'store' | 'memory';
  tokens: number;
}
