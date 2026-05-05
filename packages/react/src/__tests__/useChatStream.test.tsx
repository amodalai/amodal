/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Focused tests for using useChatStream directly (without a wrapper hook).
 * The reducer itself is covered more broadly by useChat.test.tsx and
 * useAmodalChat.test.tsx since both now delegate to this hook.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatStream } from '../hooks/useChatStream';
import type { SSEEvent } from '../types';

async function* events(list: SSEEvent[]): AsyncIterable<SSEEvent> {
  for (const e of list) {
    // Yield on a microtask so the reducer + React commit phase can settle.
    await Promise.resolve();
    yield e;
  }
}

const now = (): string => new Date().toISOString();

describe('useChatStream — direct usage', () => {
  it('dispatches tool_call_start/result events and tracks activeToolCalls', async () => {
    const streamFn = vi.fn((): AsyncIterable<SSEEvent> =>
      events([
        { type: 'init', session_id: 's1', timestamp: now() },
        { type: 'tool_call_start', tool_id: 't1', tool_name: 'read_repo_file', parameters: { path: 'a.md' }, timestamp: now() },
        { type: 'tool_call_result', tool_id: 't1', status: 'success', result: 'ok', duration_ms: 42, timestamp: now() },
        { type: 'text_delta', content: 'done', timestamp: now() },
        { type: 'done', timestamp: now() },
      ]),
    );

    const { result } = renderHook(() => useChatStream({ streamFn }));

    act(() => { result.current.send('hi'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

    expect(streamFn).toHaveBeenCalledOnce();
    expect(result.current.sessionId).toBe('s1');
    expect(result.current.activeToolCalls).toHaveLength(0);

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.type).toBe('assistant_text');
    if (last.type !== 'assistant_text') throw new Error('unreachable');
    expect(last.toolCalls).toHaveLength(1);
    expect(last.toolCalls[0]?.toolName).toBe('read_repo_file');
    expect(last.toolCalls[0]?.status).toBe('success');
    expect(last.toolCalls[0]?.duration_ms).toBe(42);

    // Content blocks carry both the tool-call block and the text block.
    expect(last.contentBlocks).toHaveLength(2);
    expect(last.contentBlocks[0]?.type).toBe('tool_calls');
    expect(last.contentBlocks[1]?.type).toBe('text');
  });

  it('calls onSessionCreated and onStreamEnd in order', async () => {
    const onSessionCreated = vi.fn();
    const onStreamEnd = vi.fn();
    const streamFn = (): AsyncIterable<SSEEvent> =>
      events([
        { type: 'init', session_id: 'abc', timestamp: now() },
        { type: 'text_delta', content: 'hi', timestamp: now() },
        { type: 'done', timestamp: now() },
      ]);

    const { result } = renderHook(() => useChatStream({ streamFn, onSessionCreated, onStreamEnd }));
    act(() => { result.current.send('x'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

    expect(onSessionCreated).toHaveBeenCalledWith('abc');
    expect(onStreamEnd).toHaveBeenCalledOnce();
  });

  it('stop() aborts the stream', async () => {
    // A streamFn that hangs until the signal fires.
    const streamFn = (_text: string, signal: AbortSignal): AsyncIterable<SSEEvent> => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'init', session_id: 's1', timestamp: now() };
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
          });
        },
      });

    const { result } = renderHook(() => useChatStream({ streamFn }));
    act(() => { result.current.send('x'); });
    await waitFor(() => { expect(result.current.sessionId).toBe('s1'); });

    act(() => { result.current.stop(); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });
    // AbortError is swallowed — no error state.
    expect(result.current.error).toBeNull();
  });

  it('reset() clears messages and state', async () => {
    const streamFn = (): AsyncIterable<SSEEvent> =>
      events([
        { type: 'init', session_id: 's1', timestamp: now() },
        { type: 'text_delta', content: 'first', timestamp: now() },
        { type: 'done', timestamp: now() },
      ]);

    const { result } = renderHook(() => useChatStream({ streamFn }));
    act(() => { result.current.send('hi'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });
    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => { result.current.reset(); });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sessionId).toBeNull();
  });

  it('surfaces stream errors via the error state', async () => {
    const streamFn = (): AsyncIterable<SSEEvent> => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'init' as const, session_id: 'err-session', timestamp: now() };
        throw new Error('transport boom');
      },
    });

    const { result } = renderHook(() => useChatStream({ streamFn }));
    act(() => { result.current.send('x'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(false); });
    expect(result.current.error).toBe('transport boom');
  });

  // -------------------------------------------------------------------
  // Phase D — Path B Proposal card reducer flows
  // -------------------------------------------------------------------

  describe('Phase D — proposal + update_plan reducer', () => {
    function streamWithProposal(): AsyncIterable<SSEEvent> {
      return events([
        { type: 'init', session_id: 'sP', timestamp: now() },
        {
          type: 'proposal',
          proposal_id: 'p_abc',
          summary: 'Plumbing scheduler + reminders',
          skills: [{ label: 'Scheduler', description: 'Daily schedule' }],
          required_connections: [{ label: 'Twilio', description: 'SMS' }],
          optional_connections: [{ label: 'Calendar', description: 'Sync' }],
          timestamp: now(),
        },
        { type: 'done', timestamp: now() },
      ]);
    }

    type StreamHookResult = ReturnType<typeof useChatStream>;

    function proposalBlockOf(result: { current: StreamHookResult }) {
      const last = result.current.messages[result.current.messages.length - 1];
      if (last.type !== 'assistant_text') throw new Error('expected assistant_text');
      const block = last.contentBlocks.find((b) => b.type === 'proposal');
      if (!block || block.type !== 'proposal') throw new Error('expected proposal block');
      return block;
    }

    it('appends a ProposalBlock from a proposal SSE event with status: pending', async () => {
      const streamFn = (): AsyncIterable<SSEEvent> => streamWithProposal();
      const { result } = renderHook(() => useChatStream({ streamFn }));
      act(() => { result.current.send('I run a plumbing company'); });
      await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

      const block = proposalBlockOf(result);
      expect(block.proposalId).toBe('p_abc');
      expect(block.status).toBe('pending');
      expect(block.summary).toBe('Plumbing scheduler + reminders');
      expect(block.skills).toHaveLength(1);
      expect(block.requiredConnections[0]?.label).toBe('Twilio');
      expect(block.optionalConnections[0]?.label).toBe('Calendar');
    });

    it('STREAM_UPDATE_PLAN patches in place by proposalId, preserving unspecified fields', async () => {
      const streamFn = (): AsyncIterable<SSEEvent> => streamWithProposal();
      const { result } = renderHook(() => useChatStream({ streamFn }));
      act(() => { result.current.send('I run a plumbing company'); });
      await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

      // Simulate the agent sending an update_plan that only changes
      // optional_connections — required + skills + summary should
      // stay intact from the original proposal.
      act(() => {
        result.current.dispatch({
          type: 'STREAM_UPDATE_PLAN',
          proposalId: 'p_abc',
          optionalConnections: [{ label: 'QuickBooks', description: 'Invoicing' }],
        });
      });

      const block = proposalBlockOf(result);
      expect(block.proposalId).toBe('p_abc');
      expect(block.summary).toBe('Plumbing scheduler + reminders');
      expect(block.skills).toEqual([{ label: 'Scheduler', description: 'Daily schedule' }]);
      expect(block.requiredConnections).toEqual([{ label: 'Twilio', description: 'SMS' }]);
      expect(block.optionalConnections).toEqual([{ label: 'QuickBooks', description: 'Invoicing' }]);
      expect(block.status).toBe('pending');
    });

    it('STREAM_UPDATE_PLAN with empty array replaces (vs undefined preserves)', async () => {
      const streamFn = (): AsyncIterable<SSEEvent> => streamWithProposal();
      const { result } = renderHook(() => useChatStream({ streamFn }));
      act(() => { result.current.send('I run a plumbing company'); });
      await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

      // optionalConnections: [] should clear, summary undefined should preserve.
      act(() => {
        result.current.dispatch({
          type: 'STREAM_UPDATE_PLAN',
          proposalId: 'p_abc',
          optionalConnections: [],
        });
      });

      const block = proposalBlockOf(result);
      expect(block.optionalConnections).toEqual([]);
      expect(block.summary).toBe('Plumbing scheduler + reminders');
    });

    it('STREAM_UPDATE_PLAN with a non-matching proposalId is a no-op', async () => {
      const streamFn = (): AsyncIterable<SSEEvent> => streamWithProposal();
      const { result } = renderHook(() => useChatStream({ streamFn }));
      act(() => { result.current.send('x'); });
      await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

      const before = proposalBlockOf(result);
      act(() => {
        result.current.dispatch({
          type: 'STREAM_UPDATE_PLAN',
          proposalId: 'never-existed',
          summary: 'should not apply',
        });
      });
      const after = proposalBlockOf(result);
      expect(after.summary).toBe(before.summary);
    });

    it('PROPOSAL_SUBMITTED locks the buttons and stores the answer', async () => {
      const streamFn = (): AsyncIterable<SSEEvent> => streamWithProposal();
      const { result } = renderHook(() => useChatStream({ streamFn }));
      act(() => { result.current.send('x'); });
      await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

      act(() => {
        result.current.dispatch({ type: 'PROPOSAL_SUBMITTED', proposalId: 'p_abc', answer: 'confirm' });
      });

      const block = proposalBlockOf(result);
      expect(block.status).toBe('submitted');
      expect(block.answer).toBe('confirm');
    });

    it('STREAM_UPDATE_PLAN re-opens a previously submitted card', async () => {
      const streamFn = (): AsyncIterable<SSEEvent> => streamWithProposal();
      const { result } = renderHook(() => useChatStream({ streamFn }));
      act(() => { result.current.send('x'); });
      await waitFor(() => { expect(result.current.isStreaming).toBe(false); });

      // User submits Adjust → card locks.
      act(() => {
        result.current.dispatch({ type: 'PROPOSAL_SUBMITTED', proposalId: 'p_abc', answer: 'adjust' });
      });
      expect(proposalBlockOf(result).status).toBe('submitted');

      // Agent sends an updated plan → card re-opens for re-confirmation.
      act(() => {
        result.current.dispatch({
          type: 'STREAM_UPDATE_PLAN',
          proposalId: 'p_abc',
          summary: 'Revised plan',
        });
      });
      const after = proposalBlockOf(result);
      expect(after.status).toBe('pending');
      expect(after.summary).toBe('Revised plan');
    });
  });
});
