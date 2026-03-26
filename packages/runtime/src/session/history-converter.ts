/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Content } from '@amodalai/core';
import type { SessionMessage } from './session-manager.js';

/**
 * Convert stored SessionMessage[] to Gemini Content[] history.
 *
 * Text-only approach — tool call structures are NOT reconstructed.
 * The assistant's text already summarizes tool results, which avoids
 * fragile reconstruction of functionCall/functionResponse pairs.
 *
 * Guarantees:
 * - Error messages and empty-text messages are skipped
 * - Adjacent same-role entries are merged (can happen after filtering)
 * - History starts with 'user' role
 * - Roles alternate (user ↔ model) as required by the Gemini API
 */
export function convertSessionMessagesToHistory(
  messages: SessionMessage[],
): Content[] {
  const history: Content[] = [];

  for (const msg of messages) {
    // Skip errors and empty text
    if (msg.type === 'error') continue;
    if (!msg.text || msg.text.trim() === '') continue;

    const role = msg.type === 'user' ? 'user' : 'model';

    // Merge adjacent same-role entries
    const last = history[history.length - 1];
    if (last && last.role === role) {
      const existingText = last.parts?.[0]?.text ?? '';
      last.parts = [{ text: `${existingText}\n\n${msg.text}` }];
    } else {
      history.push({ role, parts: [{ text: msg.text }] });
    }
  }

  // Ensure history starts with 'user' role
  while (history.length > 0 && history[0]?.role !== 'user') {
    history.shift();
  }

  // Ensure alternating roles by dropping consecutive duplicates
  // (a second pass in case the start-trim exposed new adjacencies)
  const alternating: Content[] = [];
  for (const entry of history) {
    const prev = alternating[alternating.length - 1];
    if (prev && prev.role === entry.role) {
      // Merge into previous
      const existingText = prev.parts?.[0]?.text ?? '';
      const newText = entry.parts?.[0]?.text ?? '';
      prev.parts = [{ text: `${existingText}\n\n${newText}` }];
    } else {
      alternating.push(entry);
    }
  }

  return alternating;
}
