/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {IntentDefinition} from '@amodalai/types';

/**
 * Result of a successful intent match. The runtime hands this to the
 * bypass executor (`runIntent`) which builds the IntentContext, calls
 * the handler, and emits the SSE event sequence.
 */
export interface IntentMatch {
  intent: IntentDefinition;
  match: RegExpExecArray;
}

/**
 * Walk the intent list in registration order and return the first
 * regex match against `input`. Returns null when nothing matches —
 * the caller falls through to the agent loop.
 *
 * "First match wins" is intentional: there's no priority field and no
 * tie-breaking. If two intents would match the same input, the one
 * loaded earlier wins. Intent authors keep regexes precise + anchored
 * (`^...$`) to avoid surprises.
 */
export function matchIntent(
  intents: readonly IntentDefinition[],
  input: string,
): IntentMatch | null {
  for (const intent of intents) {
    // Reset lastIndex defensively in case the regex was authored
    // with the /g flag (which would make exec() stateful and
    // produce the wrong results across multiple matches).
    intent.regex.lastIndex = 0;
    const match = intent.regex.exec(input);
    if (match) {
      return {intent, match};
    }
  }
  return null;
}
