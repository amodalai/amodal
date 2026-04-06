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

export interface OutputGuardConfig {
  tracker: ScrubTracker;
  accessConfigs: Map<string, AccessConfig>;
}

/**
 * Orchestrates output guard stages to filter agent responses
 * before the user sees them.
 */
export class OutputGuard {
  private readonly tracker: ScrubTracker;
  private readonly patternScanner: PatternScanner;
  private readonly leakDetector: LeakDetector;

  constructor(config: OutputGuardConfig) {
    this.tracker = config.tracker;
    this.patternScanner = new PatternScanner();
    this.leakDetector = new LeakDetector(config.tracker);
  }

  guard(output: string): GuardResult {
    const findings: GuardFinding[] = [];
    let text = output;
    let modified = false;

    // Stage 1: Field redaction — replace retrieve_but_redact and role_gated values
    // (role_gated is always denied in OSS runtime — no role system)
    const redactableRecords = this.tracker.getAllRecords().filter((r) => {
      if (r.policy === 'retrieve_but_redact') return true;
      if (r.policy === 'role_gated') return true;
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

    const blocked = findings.some((f) => f.severity === 'critical');

    return {output: text, modified, findings, blocked};
  }
}
