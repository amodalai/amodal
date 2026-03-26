/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {createHmac} from 'node:crypto';

export interface DeliveryPayload {
  automation: string;
  response: string;
  timestamp: string;
}

/**
 * Deliver automation results to stdout (default) or a proactive webhook.
 *
 * The agent itself handles delivery to Slack/email/etc. via connections.
 * This function only handles the system-level output of the automation run.
 */
export async function deliverResult(
  payload: DeliveryPayload,
  webhookUrl?: string,
  webhookSecret?: string,
): Promise<boolean> {
  if (webhookUrl) {
    return deliverWebhook(webhookUrl, payload, webhookSecret);
  }
  return deliverStdout(payload);
}

async function deliverWebhook(
  url: string,
  payload: DeliveryPayload,
  webhookSecret?: string,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (webhookSecret) {
    const signature = createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');
    headers['X-Amodal-Signature'] = `sha256=${signature}`;
  }

  try {
    const response = await fetch(url, {method: 'POST', headers, body});
    return response.ok;
  } catch {
    return false;
  }
}

function deliverStdout(payload: DeliveryPayload): Promise<boolean> {
  try {
    process.stdout.write(JSON.stringify(payload) + '\n');
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Verify an incoming webhook request's HMAC signature.
 */
export function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  const expectedFull = `sha256=${expected}`;

  if (signature.length !== expectedFull.length) {
    return false;
  }

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedFull);
  return sigBuffer.length === expectedBuffer.length &&
    createHmac('sha256', 'compare')
      .update(sigBuffer)
      .digest()
      .equals(
        createHmac('sha256', 'compare')
          .update(expectedBuffer)
          .digest(),
      );
}
