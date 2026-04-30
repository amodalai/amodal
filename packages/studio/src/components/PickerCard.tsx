/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AgentCard, AgentCardTurn } from '@amodalai/types';
import { AuthorBadge } from '@/components/AuthorBadge';
import { cn } from '@/lib/utils';

interface PickerCardProps {
  card: AgentCard;
  /** Marketplace category — drives the snippet-zone background tint. */
  category?: string;
  /** Author handle ('@amodal' for first-party). Renders as an avatar + name pill. */
  author?: string;
  /** True for trusted creators — adds a blue checkmark next to the author name. */
  verified?: boolean;
  /** Whether this card is currently selected in the picker. */
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Compact card for the create-flow picker. Two zones:
 *   - snippet zone (per-category tinted background, monospace) showing the
 *     agent's output
 *   - info zone (clean) showing title, tagline, and use count
 *
 * Snippet falls back to the first agent turn of `thumbnailConversation`
 * when the card doesn't ship an explicit `snippet` field. Category tint
 * defaults to the muted card surface when the category is unknown.
 */
export function PickerCard({ card, category, author, verified, selected, onClick, className }: PickerCardProps) {
  const snippet = card.snippet ?? deriveSnippet(card.thumbnailConversation);
  const usesLabel = formatUses(card.uses);
  const tintClass = categoryTint(category);

  const Container: React.ElementType = onClick ? 'button' : 'div';

  return (
    <Container
      onClick={onClick}
      className={cn(
        'group flex flex-col text-left bg-card border rounded-lg overflow-hidden transition-all',
        selected ? 'border-primary ring-1 ring-primary shadow-md' : 'border-border',
        onClick && 'cursor-pointer hover:border-foreground/20 hover:shadow-md hover:-translate-y-0.5',
        className,
      )}
    >
      {snippet && (
        <div className={cn('px-3 py-2.5 min-h-[80px]', tintClass)}>
          <div
            className="font-mono text-[10px] leading-5 text-foreground/80 whitespace-pre-line line-clamp-4"
            style={{ overflowWrap: 'anywhere' }}
          >
            {snippet}
          </div>
        </div>
      )}
      <div className="px-3 pt-2 pb-2.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          {card.icon && (
            <img src={card.icon} alt="" className="h-4 w-4 rounded shrink-0" />
          )}
          <div className="text-[12px] font-semibold text-foreground leading-tight">
            {card.title}
          </div>
        </div>
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-[10px] text-muted-foreground leading-snug truncate">
            {card.tagline}
          </span>
          {usesLabel && (
            <span className="font-mono text-[9px] text-muted-foreground/70 shrink-0">
              {usesLabel}
            </span>
          )}
        </div>
        {author && (
          <AuthorBadge author={author} verified={verified} size="sm" className="mt-1" />
        )}
      </div>
    </Container>
  );
}

/**
 * Per-category Tailwind background tint for the snippet zone. These are
 * data-palette accents (similar to EnumBadge) — intentionally raw colors
 * so the user can scan the picker and see "marketing = green, support =
 * blue" at a glance.
 */
const CATEGORY_TINTS: Record<string, string> = {
  Marketing: 'bg-emerald-50 dark:bg-emerald-950/40',
  Support: 'bg-blue-50 dark:bg-blue-950/40',
  Sales: 'bg-amber-50 dark:bg-amber-950/40',
  Ops: 'bg-violet-50 dark:bg-violet-950/40',
};

function categoryTint(category: string | undefined): string {
  return (category && CATEGORY_TINTS[category]) || 'bg-muted/40';
}

/**
 * Build a 4-line picker snippet from the first agent turn when the card
 * package doesn't ship an explicit `snippet`. Keeps the picker working for
 * older cards that haven't been updated for the create-flow spec.
 */
function deriveSnippet(turns: AgentCardTurn[]): string {
  const firstAgent = turns.find((t) => t.role === 'agent');
  if (!firstAgent) return '';
  return firstAgent.content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, 4)
    .join('\n');
}

function formatUses(uses: number | undefined): string | null {
  if (uses === undefined || uses === 0) return null;
  if (uses < 1000) return `${String(uses)} uses`;
  return `${(uses / 1000).toFixed(1).replace(/\.0$/, '')}k uses`;
}
