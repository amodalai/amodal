/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AccessConfig} from '../repo/connection-schemas.js';
import type {ScrubTracker} from './scrub-tracker.js';
import type {GuardFinding, GuardResult} from './security-types.js';
import {PatternScanner} from './pattern-scanner.js';
import {LeakDetector} from './leak-detector.js';
import {ScopeChecker} from './scope-checker.js';
import type {ScopeCheckerContext} from './scope-checker.js';

export interface OutputGuardConfig {
  tracker: ScrubTracker;
  accessConfigs: Map<string, AccessConfig>;
  userRoles: string[];
  scopeContext?: ScopeCheckerContext;
}

/**
 * Orchestrates four output guard stages to filter agent responses
 * before the user sees them.
 */
export class OutputGuard {
  private readonly tracker: ScrubTracker;
  private readonly userRoles: string[];
  private readonly patternScanner: PatternScanner;
  private readonly leakDetector: LeakDetector;
  private readonly scopeChecker: ScopeChecker | null;

  constructor(config: OutputGuardConfig) {
    this.tracker = config.tracker;
    this.userRoles = config.userRoles;
    this.patternScanner = new PatternScanner();
    this.leakDetector = new LeakDetector(config.tracker);
    this.scopeChecker = config.scopeContext
      ? new ScopeChecker(config.scopeContext)
      : null;
  }

  guard(output: string): GuardResult {
    const findings: GuardFinding[] = [];
    let text = output;
    let modified = false;

    // Stage 1: Field redaction — replace retrieve_but_redact and denied role_gated values
    const redactableRecords = this.tracker.getAllRecords().filter((r) => {
      if (r.policy === 'retrieve_but_redact') return true;
      if (r.policy === 'role_gated') {
        // Check if user lacks role
        const restriction = this.findRestrictionForRecord(r);
        if (!restriction) return true; // conservative
        const allowed = restriction.allowedRoles;
        if (!allowed || allowed.length === 0) return true;
        return !this.userRoles.some((role) => allowed.includes(role));
      }
      return false;
    });

    for (const record of redactableRecords) {
      if (record.value.length < 2) continue;
      if (text.includes(record.value)) {
        text = text.split(record.value).join('[REDACTED]');
        modified = true;
        findings.push({
          type: 'field_redaction',
          description: `Redacted ${record.sensitivity} field "${record.field}" from ${record.entity}`,
          severity: 'info',
        });
      }
    }

    // Stage 2: Pattern scan — regex for SSN/CC/bank patterns
    const patterns = this.patternScanner.scan(text);
    for (const p of patterns) {
      text = text.split(p.match).join('[REDACTED]');
      modified = true;
      findings.push({
        type: 'pattern_match',
        description: `Detected ${p.pattern} pattern`,
        location: `index ${p.index}`,
        severity: 'critical',
      });
    }

    // Stage 3: Leak detection — compare against tracker values
    const leaks = this.leakDetector.detect(text);
    for (const leak of leaks) {
      const severity =
        leak.record.sensitivity === 'pii_identifier' ? 'critical' : 'warning';
      if (severity === 'critical') {
        text = text.split(leak.matchedText).join('[REDACTED]');
        modified = true;
      }
      findings.push({
        type: 'leak_detected',
        description: `Leaked ${leak.record.sensitivity} value for ${leak.record.entity}.${leak.record.field}`,
        severity,
      });
    }

    // Stage 4: Scope check — flag unqualified aggregates
    if (this.scopeChecker) {
      const violations = this.scopeChecker.check(text);
      for (const v of violations) {
        findings.push({
          type: 'scope_violation',
          description: `Unqualified aggregate for "${v.entity}" — expected: ${v.expectedQualification}`,
          location: v.snippet,
          severity: 'warning',
        });
      }
    }

    const blocked = findings.some((f) => f.severity === 'critical');

    return {output: text, modified, findings, blocked};
  }

  /**
   * Look up the original restriction for a scrub record.
   * Returns a minimal object with allowedRoles for the role check.
   */
  private findRestrictionForRecord(
    record: {entity: string; field: string; connectionName: string},
  ): {allowedRoles?: string[]} | undefined {
    const accessConfig = this.tracker
      .getAllRecords()
      .find(
        (r) =>
          r.entity === record.entity &&
          r.field === record.field &&
          r.connectionName === record.connectionName,
      );
    // We don't have direct access to the restriction, but we stored policy
    // For role_gated, we need the original restriction's allowedRoles
    // Since we only have the record, treat missing roles as denied (conservative)
    return accessConfig ? {allowedRoles: []} : undefined;
  }
}
