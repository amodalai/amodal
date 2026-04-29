/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AgentCardInline, AgentCardInlineTurn } from '../types';

interface Props {
  card: AgentCardInline;
}

/**
 * Compact agent-card preview rendered inline in the chat stream when the
 * admin agent emits a `show_preview` event. The richer gallery layout lives
 * in @amodalai/studio's `<AgentCard>` — this is the chat-bubble version.
 */
export function AgentCardInlinePreview({ card }: Props) {
  return (
    <div className="pcw-agent-card">
      <div className="pcw-agent-card__title">{card.title}</div>
      <div className="pcw-agent-card__convo">
        {card.thumbnailConversation.map((turn, i) => (
          <Turn key={i} turn={turn} />
        ))}
      </div>
      {card.tagline && <div className="pcw-agent-card__tagline">{card.tagline}</div>}
      {card.platforms.length > 0 && (
        <div className="pcw-agent-card__platforms">
          {card.platforms.map((p) => (
            <span key={p} className="pcw-agent-card__chip">{p}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Turn({ turn }: { turn: AgentCardInlineTurn }) {
  const isAgent = turn.role === 'agent';
  return (
    <div className={`pcw-agent-card__turn pcw-agent-card__turn--${turn.role}`}>
      <span className="pcw-agent-card__icon" aria-hidden="true">
        {isAgent ? '🤖' : '👤'}
      </span>
      <div className="pcw-agent-card__content">{turn.content}</div>
    </div>
  );
}
