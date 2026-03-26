/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Knowledge base document categories.
 *
 * Application-level categories (shared across all tenants):
 *   system_docs       — API documentation, endpoint references (from connections)
 *   methodology       — How to interpret data, what metrics mean, domain expertise
 *   patterns          — Known bad patterns, attack signatures, indicators
 *   false_positives   — Things that look bad but aren't
 *   response_procedures — SOPs, regulatory requirements, escalation frameworks
 *
 * Tenant-level categories (specific to one deployment):
 *   environment       — Operational layout, known inventory, restrictions
 *   baselines         — What "normal" looks like at this deployment
 *   team              — Who works here, shifts, roles, preferences
 *   incident_history  — Past incidents, resolutions, recurring patterns
 *   working_memory    — Cross-session agent learning (auto-managed)
 */
export type DocumentCategory =
  | 'system_docs'
  | 'methodology'
  | 'patterns'
  | 'false_positives'
  | 'response_procedures'
  | 'environment'
  | 'baselines'
  | 'team'
  | 'incident_history'
  | 'working_memory';

/**
 * Document scope: application-level (shared across all tenants) or tenant-level.
 */
export type ScopeType = 'application' | 'tenant';

/**
 * Declares which knowledge base documents a skill needs loaded when activated.
 */
export interface SkillKnowledgeDeps {
  /** Docs matching any of these tags are auto-loaded on skill activation. */
  tags?: string[];
  /** Restrict to a specific scope, or 'all' for both application and tenant. Default: 'all'. */
  scope?: 'application' | 'tenant' | 'all';
}

/**
 * A knowledge base document record.
 * Mirrors the platform-api DocumentRecord shape (no cross-package import).
 */
export interface KBDocument {
  id: string;
  scope_type: ScopeType;
  scope_id: string;
  title: string;
  category: DocumentCategory;
  body: string;
  tags: string[];
  status: string;
  source?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}
