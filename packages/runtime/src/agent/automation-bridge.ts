/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {resolveEnvValue} from '@amodalai/core';
import type {LoadedAutomation} from '@amodalai/core';
import type {DeliveryConfig, DeliveryTarget, FailureAlertConfig} from '@amodalai/types';

/**
 * Parsed automation config ready for the proactive runner.
 */
export interface RunnableAutomation {
  name: string;
  title: string;
  prompt: string;
  schedule?: string;
  isWebhookTriggered: boolean;
  delivery?: DeliveryConfig;
  failureAlert?: FailureAlertConfig;
}

/**
 * Convert a LoadedAutomation into a runnable config.
 *
 * Resolves `env:NAME` references in delivery webhook URLs at bundle-load
 * time via `resolveEnvValue` (which throws RepoError if the env var is
 * missing). Failing fast at startup is deliberate — an operator who
 * misconfigured their SLACK_WEBHOOK_URL should learn at server boot, not
 * the first time an automation tries to deliver.
 */
export function bridgeAutomation(automation: LoadedAutomation): RunnableAutomation {
  return {
    name: automation.name,
    title: automation.title,
    prompt: automation.prompt,
    schedule: automation.schedule,
    isWebhookTriggered: automation.trigger === 'webhook',
    delivery: automation.delivery ? resolveDeliveryEnvRefs(automation.delivery) : undefined,
    failureAlert: automation.failureAlert
      ? {
          ...automation.failureAlert,
          targets: automation.failureAlert.targets.map(resolveTargetEnvRefs),
        }
      : undefined,
  };
}

function resolveDeliveryEnvRefs(delivery: DeliveryConfig): DeliveryConfig {
  return {
    ...delivery,
    targets: delivery.targets.map(resolveTargetEnvRefs),
  };
}

function resolveTargetEnvRefs(target: DeliveryTarget): DeliveryTarget {
  if (target.type === 'webhook') {
    return {...target, url: resolveEnvValue(target.url)};
  }
  return target;
}

/**
 * Bridge all automations from a repo.
 */
export function bridgeAutomations(automations: LoadedAutomation[]): RunnableAutomation[] {
  return automations.map(bridgeAutomation);
}
