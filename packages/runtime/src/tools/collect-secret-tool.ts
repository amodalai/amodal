/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * collect_secret tool — renders an inline API key input form in the chat.
 * The secret value goes directly from the widget to /api/secrets via
 * browser fetch, never touching the LLM.
 *
 * Used by the admin agent when the user asks to connect a service
 * that requires an API key.
 */

import {z} from 'zod';
import type {ToolRegistry, ToolContext} from './types.js';
import {SSEEventType} from '../types.js';
import type {SSECollectSecretEvent} from '../types.js';

export function registerCollectSecretTool(registry: ToolRegistry): void {
  registry.register('collect_secret', {
    description:
      'Show an inline form for the user to enter an API key or secret. ' +
      'The value is saved securely and never sent to the chat. ' +
      'Use this for connections that need API keys (not OAuth).',
    parameters: z.object({
      name: z.string().describe('Environment variable name (e.g. SENDGRID_API_KEY)'),
      label: z.string().describe('Human-readable label for the input'),
      description: z.string().optional().describe('Help text about where to find the key'),
      link: z.string().optional().describe('URL to the provider dashboard where the key is found'),
      required: z.boolean().default(true),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(
      params: {name: string; label: string; description?: string; link?: string; required: boolean},
      ctx: ToolContext,
    ) {
      const secretId = `secret_${ctx.sessionId}_${Date.now().toString(36)}`;

      const event: SSECollectSecretEvent = {
        type: SSEEventType.CollectSecret,
        secret_id: secretId,
        name: params.name,
        label: params.label,
        description: params.description,
        link: params.link,
        required: params.required,
        timestamp: new Date().toISOString(),
      };

      ctx.emit?.(event);

      return {ok: true, secret_id: secretId, name: params.name};
    },
  });
}
