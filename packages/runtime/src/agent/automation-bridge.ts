/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedAutomation} from '@amodalai/core';
import type {DeliveryConfig, FailureAlertConfig} from '@amodalai/types';

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
 */
export function bridgeAutomation(automation: LoadedAutomation): RunnableAutomation {
  return {
    name: automation.name,
    title: automation.title,
    prompt: automation.prompt,
    schedule: automation.schedule,
    isWebhookTriggered: automation.trigger === 'webhook',
    delivery: automation.delivery,
    failureAlert: automation.failureAlert,
  };
}

/**
 * Bridge all automations from a repo.
 */
export function bridgeAutomations(automations: LoadedAutomation[]): RunnableAutomation[] {
  return automations.map(bridgeAutomation);
}
