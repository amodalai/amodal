/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AuthorBadgeProps {
  /** Author handle (e.g. "@amodal", "@growthlab"). */
  author: string;
  /** True when the author is in the trusted-creator set; renders the blue check. */
  verified?: boolean;
  /** Visual size — `sm` for picker cards, `md` for the detail header. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Small inline badge used on template cards + the detail header to show who
 * publishes the template. The avatar is a single-letter square in a stable
 * color derived from the author handle, so the same author always reads the
 * same color across the catalog.
 */
export function AuthorBadge({ author, verified, size = 'sm', className }: AuthorBadgeProps) {
  const initial = (author.replace(/^@/, '')[0] ?? '?').toUpperCase();
  const colorClass = avatarColor(author);
  const dims = size === 'md' ? 'w-[18px] h-[18px] text-[9px]' : 'w-[14px] h-[14px] text-[7.5px]';
  const checkSize = size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5';
  const labelSize = size === 'md' ? 'text-[12px]' : 'text-[9.5px]';

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div
        className={cn(
          'rounded-[4px] flex items-center justify-center text-white font-mono font-bold shrink-0',
          dims,
          colorClass,
        )}
        aria-hidden="true"
      >
        {initial}
      </div>
      <span className={cn(labelSize, size === 'md' ? 'text-foreground/70 font-medium' : 'text-muted-foreground')}>
        {author}
      </span>
      {verified && (
        <BadgeCheck
          className={cn('shrink-0 fill-blue-500 text-white', checkSize)}
          aria-label="Verified creator"
        />
      )}
    </div>
  );
}

/**
 * Stable avatar color from the author handle. Hashes to one of N preset
 * Tailwind color classes — same author always gets the same swatch.
 */
const AVATAR_PALETTE: readonly string[] = [
  'bg-emerald-700',
  'bg-blue-700',
  'bg-amber-700',
  'bg-violet-700',
  'bg-rose-700',
  'bg-cyan-700',
  'bg-orange-700',
  'bg-indigo-700',
];

function avatarColor(author: string): string {
  // First-party templates always render in the foreground color so the
  // brand-owned set is visually distinct from community contributions.
  if (author === '@amodal' || author === 'amodal') return 'bg-foreground';
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = (hash * 31 + author.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx] ?? AVATAR_PALETTE[0] ?? 'bg-foreground';
}
