/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {IntentDefinition} from '@amodalai/types';
import {matchIntent} from './matcher.js';

const noopHandle = async (): Promise<null> => null;

function intent(id: string, regex: RegExp): IntentDefinition {
  return {id, regex, handle: noopHandle};
}

describe('matchIntent', () => {
  it('returns null when no intent matches', () => {
    const intents = [intent('a', /^hello$/), intent('b', /^world$/)];
    expect(matchIntent(intents, 'unrelated')).toBeNull();
  });

  it('matches and exposes capture groups', () => {
    const intents = [intent('install', /^Set up template '(.+)'\.?$/)];
    const result = matchIntent(intents, "Set up template 'marketing-digest'.");
    expect(result).not.toBeNull();
    expect(result?.intent.id).toBe('install');
    expect(result?.match[1]).toBe('marketing-digest');
  });

  it('first match wins when multiple intents would match', () => {
    const intents = [
      intent('first', /^hello (.+)$/),
      intent('second', /^hello world$/),
    ];
    const result = matchIntent(intents, 'hello world');
    expect(result?.intent.id).toBe('first');
    expect(result?.match[1]).toBe('world');
  });

  it('treats unanchored regexes literally — author responsibility', () => {
    // "matchIntent" itself doesn't enforce anchoring, but unanchored
    // regexes are surprising. This test documents the behavior:
    // "say hello to me" matches /hello/ even though probably not
    // what the author wanted.
    const intents = [intent('hello', /hello/)];
    const result = matchIntent(intents, 'say hello to me');
    expect(result?.intent.id).toBe('hello');
  });

  it('resets lastIndex on /g-flagged regexes so repeated calls work', () => {
    // Defensive: a global regex with state would otherwise produce
    // null on the second call.
    const intents = [intent('global', /^hello$/g)];
    expect(matchIntent(intents, 'hello')?.intent.id).toBe('global');
    expect(matchIntent(intents, 'hello')?.intent.id).toBe('global');
  });

  it('handles an empty intent list', () => {
    expect(matchIntent([], 'anything')).toBeNull();
  });
});
