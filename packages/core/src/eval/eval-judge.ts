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
    'You are an eval judge. Determine if the assistant response satisfies the assertion.',
    '',
    '## Assistant Response',
    response,
    '',
    '## Assertion',
    `The response ${direction}: ${assertion.text}`,
    '',
    '## Instructions',
    'Reply with exactly one line in the format:',
    'PASS: <reason with specific evidence from the response>',
    'or',
    'FAIL: <reason citing what was wrong, missing, or incorrect — quote specific text or data from the response and tool results that demonstrates the failure>',
    '',
    'Be concrete. Reference actual content from the response. Do not give generic reasons like "the response does not satisfy the assertion".',
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
