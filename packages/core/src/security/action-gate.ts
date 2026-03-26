/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AccessConfig} from '../repo/connection-schemas.js';
import type {GateDecision, GateResult} from './security-types.js';
import {ThresholdEvaluator} from './threshold-evaluator.js';

export interface ActionGateConfig {
  accessConfigs: Map<string, AccessConfig>;
  isDelegated: boolean;
}

/**
 * Controls write operations based on confirmation tiers from access config.
 */
export class ActionGate {
  private readonly accessConfigs: Map<string, AccessConfig>;
  private readonly isDelegated: boolean;
  private readonly thresholdEvaluator: ThresholdEvaluator;

  constructor(config: ActionGateConfig) {
    this.accessConfigs = config.accessConfigs;
    this.isDelegated = config.isDelegated;
    this.thresholdEvaluator = new ThresholdEvaluator();
  }

  evaluate(
    endpointPath: string,
    connectionName: string,
    params?: Record<string, unknown>,
  ): GateResult {
    const accessConfig = this.accessConfigs.get(connectionName);
    if (!accessConfig) {
      return {
        decision: 'allow',
        endpointPath,
        escalated: false,
      };
    }

    const endpoint = accessConfig['endpoints'][endpointPath];
    if (!endpoint) {
      return {
        decision: 'allow',
        endpointPath,
        escalated: false,
      };
    }

    // Base tier from confirm field
    let decision: GateDecision = this.resolveBaseTier(endpoint.confirm);
    let reason = endpoint.reason;
    let escalated = false;

    // Threshold evaluation
    if (
      endpoint.thresholds &&
      endpoint.thresholds.length > 0 &&
      params
    ) {
      const thresholdResult = this.thresholdEvaluator.evaluate(
        endpoint.thresholds,
        params,
      );
      if (thresholdResult !== null) {
        const escalatedDecision = this.escalateDecision(
          decision,
          thresholdResult,
        );
        if (escalatedDecision !== decision) {
          decision = escalatedDecision;
          escalated = true;
          reason = `Threshold escalation: ${reason ?? 'parameter exceeded limit'}`;
        }
      }
    }

    // Delegation escalation
    if (this.isDelegated && accessConfig.delegations?.escalateConfirm) {
      if (decision === 'confirm') {
        decision = 'review';
        escalated = true;
        reason = `Delegated agent escalation: ${reason ?? 'confirm → review'}`;
      }
    }

    return {decision, reason, escalated, endpointPath};
  }

  private resolveBaseTier(
    confirm: true | 'review' | 'never' | undefined,
  ): GateDecision {
    if (confirm === undefined) return 'allow';
    if (confirm === true) return 'confirm';
    return confirm;
  }

  private escalateDecision(
    current: GateDecision,
    escalation: 'review' | 'never',
  ): GateDecision {
    const hierarchy: GateDecision[] = ['allow', 'confirm', 'review', 'never'];
    const currentIdx = hierarchy.indexOf(current);
    const escalationIdx = hierarchy.indexOf(escalation);
    return escalationIdx > currentIdx ? escalation : current;
  }
}
