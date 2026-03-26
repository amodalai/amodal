/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ScopingRule} from '../repo/connection-schemas.js';

/**
 * A scope violation finding.
 */
export interface ScopeViolation {
  entity: string;
  snippet: string;
  expectedQualification: string;
}

export interface ScopeCheckerContext {
  scopeRules: Record<string, ScopingRule>;
  scopeLabels: Record<string, string>;
}

/**
 * Aggregate keywords that indicate unqualified statements.
 */
const AGGREGATE_PATTERN =
  /\b(?:all|every|total|across all|entire|whole|all of the|each and every)\b/gi;

/**
 * Checks agent output for unqualified aggregate claims about scoped entities.
 */
export class ScopeChecker {
  private readonly scopeRules: Record<string, ScopingRule>;
  private readonly scopeLabels: Record<string, string>;

  constructor(context: ScopeCheckerContext) {
    this.scopeRules = context.scopeRules;
    this.scopeLabels = context.scopeLabels;
  }

  check(text: string): ScopeViolation[] {
    const violations: ScopeViolation[] = [];
    const entityNames = Object.keys(this.scopeRules);

    if (entityNames.length === 0) return violations;

    // Find aggregate keywords and check nearby entity mentions
    let m: RegExpExecArray | null;
    const re = new RegExp(AGGREGATE_PATTERN.source, 'gi');
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 80);
      const end = Math.min(text.length, m.index + m[0].length + 80);
      const snippet = text.slice(start, end);

      for (const entity of entityNames) {
        const rule = this.scopeRules[entity];
        if (!rule) continue;

        // Only flag field_match and through_relation scoping
        if (rule.type === 'all') continue;

        if (snippet.toLowerCase().includes(entity.toLowerCase())) {
          const label =
            this.scopeLabels[entity] ?? rule.label ?? `scoped by ${rule.type}`;
          violations.push({
            entity,
            snippet: snippet.trim(),
            expectedQualification: label,
          });
        }
      }
    }

    return violations;
  }
}
