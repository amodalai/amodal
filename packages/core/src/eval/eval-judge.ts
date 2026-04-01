/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AssertionResult} from './eval-types.js';

/**
 * Provider interface for LLM-based judgment.
 */
export interface JudgeProvider {
  judge(prompt: string): Promise<string>;
}

/**
 * Judge whether a response satisfies an assertion using an LLM.
 */
export async function judgeAssertion(
  response: string,
  assertion: {text: string; negated: boolean},
  provider: JudgeProvider,
): Promise<AssertionResult> {
  const direction = assertion.negated ? 'should NOT' : 'should';
  const prompt = [
    'You are an eval judge. You are grading the quality of an AI assistant\'s TEXT RESPONSE to a user.',
    '',
    'The assistant had access to tools and may have called APIs. The tool calls and their raw results',
    'are shown below for context — use them ONLY to verify accuracy (e.g. did the assistant fabricate data?).',
    '',
    'IMPORTANT: Grade the assistant\'s TEXT RESPONSE, not the tool results. If the tool returned good data',
    'but the assistant\'s text response is missing information, vague, or incomplete, that is a FAIL.',
    'The user only sees the text response, not the raw tool output.',
    '',
    '## Assistant\'s Text Response (THIS is what you are grading)',
    response,
    '',
    '## Assertion',
    `The assistant's text response ${direction}: ${assertion.text}`,
    '',
    '## Instructions',
    'Reply with exactly one line in the format:',
    'PASS: <reason with specific evidence from the text response>',
    'or',
    'FAIL: <reason citing what was wrong, missing, or incorrect in the text response>',
    '',
    'Be concrete. Quote from the text response. If the tool results have good data but the text response doesn\'t present it, that is a FAIL.',
    'Nothing else.',
  ].join('\n');

  try {
    const raw = await provider.judge(prompt);
    const line = raw.trim().split('\n')[0];
    const passMatch = /^PASS:\s*(.*)$/i.exec(line);
    const failMatch = /^FAIL:\s*(.*)$/i.exec(line);

    if (passMatch) {
      return {
        text: assertion.text,
        negated: assertion.negated,
        passed: true,
        reason: passMatch[1].trim(),
      };
    }

    if (failMatch) {
      return {
        text: assertion.text,
        negated: assertion.negated,
        passed: false,
        reason: failMatch[1].trim(),
      };
    }

    // Couldn't parse — treat as failure
    return {
      text: assertion.text,
      negated: assertion.negated,
      passed: false,
      reason: `Judge response unparseable: ${line}`,
    };
  } catch (err) {
    return {
      text: assertion.text,
      negated: assertion.negated,
      passed: false,
      reason: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Judge all assertions for a response.
 */
export async function judgeAllAssertions(
  response: string,
  assertions: Array<{text: string; negated: boolean}>,
  provider: JudgeProvider,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const assertion of assertions) {
    results.push(await judgeAssertion(response, assertion, provider));
  }
  return results;
}
