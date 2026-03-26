/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useRef, useState } from 'react';
import { useAmodalContext } from '../provider';

export interface UseSkillActionOptions {
  /** Store names this skill writes to (for context in the prompt). */
  stores?: string[];
  /** Whether to include a confirmation hint in the prompt. */
  confirm?: boolean;
}

export interface UseSkillActionReturn {
  /** Execute the skill with the given parameters. */
  execute: (params?: Record<string, unknown>) => void;
  /** Whether the skill is currently running. */
  loading: boolean;
  /** The text result from the skill execution. */
  result: string | null;
  /** Error message if execution failed. */
  error: string | null;
}

/**
 * Invoke a skill via the chat agent.
 *
 * Under the hood, this sends a structured chat message asking the agent
 * to run the skill, then collects the text response.
 *
 * @example
 * ```tsx
 * const investigate = useSkillAction('deep-investigator', {
 *   stores: ['active-alerts', 'incident-correlations'],
 * });
 *
 * <button onClick={() => investigate.execute({ correlationId: '123' })}>
 *   Investigate
 * </button>
 * ```
 */
export function useSkillAction(
  skillName: string,
  options: UseSkillActionOptions = {},
): UseSkillActionReturn {
  const { client } = useAmodalContext();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    (params?: Record<string, unknown>) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setResult(null);
      setError(null);

      // Build a structured prompt for the agent
      let prompt = `Run skill "${skillName}"`;
      if (params && Object.keys(params).length > 0) {
        prompt += ` with parameters: ${JSON.stringify(params)}`;
      }
      if (options.stores && options.stores.length > 0) {
        prompt += `. Write results to stores: ${options.stores.join(', ')}`;
      }
      if (options.confirm) {
        prompt += '. Confirm before writing.';
      }

      void (async () => {
        try {
          let text = '';
          for await (const event of client.chatStream(prompt, { signal: controller.signal })) {
            switch (event.type) {
              case 'text_delta':
                text += event.content;
                break;
              case 'error':
                setError(event.message);
                break;
              default:
                break;
            }
          }
          setResult(text);
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError(err instanceof Error ? err.message : 'Skill execution failed');
          }
        } finally {
          setLoading(false);
          abortRef.current = null;
        }
      })();
    },
    [client, skillName, options.stores, options.confirm],
  );

  return { execute, loading, result, error };
}
