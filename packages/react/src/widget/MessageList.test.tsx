/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase H.2 regression tests for MessageList's `inlineBlockRenderers`
 * fallback path. The test surface is narrow on purpose — only the
 * registry resolution flow, since that's the one path every
 * connection_panel block now traverses.
 *
 * Native types (text, ask_choice, proposal, etc.) are NOT covered
 * here — they have their own tests and are explicitly NOT
 * registry-overridable.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MessageList } from './MessageList';
import type {
  AssistantTextMessage,
  BlockRendererProps,
  ConnectionPanelBlock,
  InlineBlockRendererRegistry,
} from '../types';

function makeAssistantMessage(blocks: ConnectionPanelBlock[]): AssistantTextMessage {
  return {
    type: 'assistant_text',
    id: 'msg-1',
    text: '',
    toolCalls: [],
    confirmations: [],
    skillActivations: [],
    kbProposals: [],
    widgets: [],
    contentBlocks: blocks,
    timestamp: new Date().toISOString(),
  };
}

function makePanel(overrides: Partial<ConnectionPanelBlock> = {}): ConnectionPanelBlock {
  return {
    type: 'connection_panel',
    panelId: 'panel-1',
    packageName: '@amodalai/connection-slack',
    displayName: 'Slack',
    description: 'Where the digest gets posted',
    skippable: false,
    state: 'idle',
    ...overrides,
  };
}

describe('MessageList — inlineBlockRenderers (Phase H.2)', () => {
  it('falls back to a placeholder when no renderer is registered', () => {
    const message = makeAssistantMessage([makePanel()]);
    render(
      <MessageList
        messages={[message]}
        isStreaming={false}
      />,
    );
    expect(screen.getByText(/connection_panel/)).toBeInTheDocument();
    expect(screen.getByText(/no renderer registered/)).toBeInTheDocument();
  });

  it('routes a connection_panel block through a registered renderer', () => {
    const Renderer = vi.fn(({ block }: BlockRendererProps<ConnectionPanelBlock>) => (
      <div data-testid="custom-panel">{block.displayName}</div>
    ));
    const registry: InlineBlockRendererRegistry = {
      connection_panel: Renderer,
    };
    const message = makeAssistantMessage([makePanel({ displayName: 'Slack' })]);
    render(
      <MessageList
        messages={[message]}
        isStreaming={false}
        inlineBlockRenderers={registry}
        dispatch={vi.fn()}
      />,
    );
    expect(screen.getByTestId('custom-panel')).toHaveTextContent('Slack');
    expect(Renderer).toHaveBeenCalled();
  });

  it('passes dispatch + postUserMessage to registered renderers', async () => {
    const dispatch = vi.fn();
    const sendMessage = vi.fn();
    const Renderer = ({
      block,
      dispatch: dispatchProp,
      postUserMessage,
    }: BlockRendererProps<ConnectionPanelBlock>) => (
      <div>
        <button
          type="button"
          onClick={() =>
            dispatchProp({
              type: 'PANEL_UPDATE',
              panelId: block.panelId,
              patch: { state: 'skipped', userSkipped: true },
            })
          }
        >
          skip
        </button>
        <button type="button" onClick={() => postUserMessage(`Skip ${block.displayName} for now`)}>
          post
        </button>
      </div>
    );
    const registry: InlineBlockRendererRegistry = { connection_panel: Renderer };
    const message = makeAssistantMessage([makePanel()]);
    render(
      <MessageList
        messages={[message]}
        isStreaming={false}
        inlineBlockRenderers={registry}
        dispatch={dispatch}
        sendMessage={sendMessage}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'skip' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PANEL_UPDATE',
      panelId: 'panel-1',
      patch: { state: 'skipped', userSkipped: true },
    });
    await userEvent.click(screen.getByRole('button', { name: 'post' }));
    expect(sendMessage).toHaveBeenCalledWith('Skip Slack for now');
  });
});
