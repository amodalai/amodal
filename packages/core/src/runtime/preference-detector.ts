/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {JudgeProvider} from '../eval/eval-judge.js';

/**
 * A detected preference from a conversation.
 */
export interface DetectedPreference {
  category: 'style' | 'content' | 'behavior' | 'domain';
  preference: string;
  confidence: number;
  source: 'correction' | 'explicit' | 'inferred';
}

/**
 * Detect corrections and preferences in a conversation using an LLM.
 */
export async function detectPreferences(
  conversation: Array<{role: 'user' | 'assistant'; content: string}>,
  provider: JudgeProvider,
): Promise<DetectedPreference[]> {
  if (conversation.length < 2) return [];

  // Only look at user messages for corrections
  const userMessages = conversation
    .filter((m) => m.role === 'user')
    .map((m) => m.content);

  // Simple heuristic detection for common correction patterns
  const preferences: DetectedPreference[] = [];

  for (const message of userMessages) {
    const lower = message.toLowerCase();

    // Check for explicit corrections
    if (hasCorrection(lower)) {
      const detected = await extractPreferenceWithLLM(message, provider);
      if (detected) {
        preferences.push(detected);
      }
    }
  }

  return preferences;
}

/**
 * Check if a message contains a correction pattern.
 */
function hasCorrection(message: string): boolean {
  const patterns = [
    'no, ',
    'not that',
    'instead ',
    "don't ",
    "let's not",
    'actually ',
    'i prefer',
    'i want',
    'make it ',
    'can you ',
    'please use',
    'shorter',
    'longer',
    'more concise',
    'more detailed',
    'in table form',
    'as a list',
  ];

  return patterns.some((p) => message.includes(p));
}

/**
 * Use an LLM to extract a structured preference from a correction message.
 */
async function extractPreferenceWithLLM(
  message: string,
  provider: JudgeProvider,
): Promise<DetectedPreference | null> {
  const prompt = [
    'Extract a user preference from this message. If it expresses a preference for how responses should be formatted or what they should contain, extract it.',
    '',
    `Message: "${message}"`,
    '',
    'Reply with exactly one line in the format:',
    'PREF: category=<style|content|behavior|domain> preference=<the preference> source=<correction|explicit>',
    'or',
    'NONE: no clear preference detected',
    '',
    'Nothing else.',
  ].join('\n');

  try {
    const response = await provider.judge(prompt);
    const line = response.trim().split('\n')[0];

    const prefMatch = /^PREF:\s*category=(\w+)\s+preference=(.+?)\s+source=(\w+)$/i.exec(line);
    if (prefMatch) {
      const rawCategory = prefMatch[1];
      const validCategories = new Set<string>(['style', 'content', 'behavior', 'domain']);
      if (!validCategories.has(rawCategory)) return null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
      const category = rawCategory as DetectedPreference['category'];

      return {
        category,
        preference: prefMatch[2].trim(),
        confidence: 0.7,
        source: prefMatch[3] === 'explicit' ? 'explicit' : 'correction',
      };
    }

    return null;
  } catch {
    return null;
  }
}
