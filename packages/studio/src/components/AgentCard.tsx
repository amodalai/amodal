/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AgentCard, AgentCardPreview, AgentCardTurn } from '@amodalai/types';
import { cn } from '@/lib/utils';

type Variant = 'thumbnail' | 'expanded';

interface AgentCardProps {
  /** Card data — `card.json` for thumbnail, `preview.json` for expanded. */
  card: AgentCard | AgentCardPreview;
  /** Thumbnail (gallery / chat) vs expanded (detail page) layout. */
  variant?: Variant;
  /** Click handler for the "Use this →" CTA. Omit to hide the CTA. */
  onUse?: () => void;
  /** Optional click handler for the entire card (gallery navigation). */
  onClick?: () => void;
  /** Optional "Featured" badge — staff-curated home-screen surface. */
  featured?: boolean;
  className?: string;
}

function isPreview(card: AgentCard | AgentCardPreview): card is AgentCardPreview {
  return 'conversation' in card;
}

function turnsOf(card: AgentCard | AgentCardPreview): AgentCardTurn[] {
  return isPreview(card) ? card.conversation : card.thumbnailConversation;
}

function blurbOf(card: AgentCard | AgentCardPreview): string {
  return isPreview(card) ? card.description : card.tagline;
}

function ConversationTurn({ turn }: { turn: AgentCardTurn }) {
  const isAgent = turn.role === 'agent';
  return (
    <div className="flex gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 select-none text-base leading-6',
          isAgent ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {isAgent ? '🤖' : '👤'}
      </span>
      <div
        className={cn(
          'whitespace-pre-wrap break-words text-sm leading-6',
          isAgent ? 'text-foreground' : 'text-muted-foreground',
        )}
        style={{ overflowWrap: 'anywhere' }}
      >
        {turn.content}
      </div>
    </div>
  );
}

export function AgentCard({
  card,
  variant = 'thumbnail',
  onUse,
  onClick,
  featured,
  className,
}: AgentCardProps) {
  const turns = turnsOf(card);
  const blurb = blurbOf(card);
  const isExpanded = variant === 'expanded';
  const interactive = Boolean(onClick);

  const Container: React.ElementType = interactive ? 'button' : 'div';

  return (
    <Container
      onClick={onClick}
      className={cn(
        'flex flex-col text-left bg-card border border-border rounded-lg overflow-hidden transition-colors',
        interactive && 'hover:border-primary/40 cursor-pointer',
        isExpanded ? 'p-6 gap-5' : 'p-4 gap-3',
        className,
      )}
    >
      <header className="flex items-start gap-2">
        <h3
          className={cn(
            'flex-1 font-semibold text-foreground leading-tight',
            isExpanded ? 'text-xl' : 'text-base',
          )}
        >
          {card.title}
        </h3>
        {featured && (
          <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary">
            Featured
          </span>
        )}
      </header>

      <div
        className={cn(
          'flex flex-col gap-3 bg-muted/40 border border-border rounded-md p-3',
          !isExpanded && 'max-h-64 overflow-hidden',
        )}
      >
        {turns.map((turn, i) => (
          <ConversationTurn key={i} turn={turn} />
        ))}
      </div>

      {blurb && (
        <p
          className={cn(
            'text-muted-foreground',
            isExpanded ? 'text-sm leading-6' : 'text-xs leading-5',
          )}
        >
          {blurb}
        </p>
      )}

      {card.platforms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {card.platforms.map((p) => (
            <span
              key={p}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
            >
              {p}
            </span>
          ))}
        </div>
      )}

      {onUse && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUse();
          }}
          className="self-start px-3 py-1.5 rounded-md bg-primary-solid text-white text-sm font-medium hover:bg-primary-solid/90 transition-colors"
        >
          Use this →
        </button>
      )}
    </Container>
  );
}
