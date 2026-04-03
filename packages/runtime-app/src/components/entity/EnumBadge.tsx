/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { cn } from '@/lib/utils';

/**
 * Deterministic color hash for enum values.
 * Maps a string to one of several predefined color classes.
 */
const ENUM_COLORS = [
  'bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-400',
  'bg-green-100 dark:bg-green-500/10 text-green-800 dark:text-green-400',
  'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-800 dark:text-yellow-400',
  'bg-red-100 dark:bg-red-500/10 text-red-800 dark:text-red-400',
  'bg-purple-100 dark:bg-purple-500/10 text-purple-800 dark:text-purple-400',
  'bg-pink-100 dark:bg-pink-500/10 text-pink-800 dark:text-pink-400',
  'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-400',
  'bg-orange-100 dark:bg-orange-500/10 text-orange-800 dark:text-orange-400',
  'bg-teal-100 dark:bg-teal-500/10 text-teal-800 dark:text-teal-400',
  'bg-cyan-100 dark:bg-cyan-500/10 text-cyan-800 dark:text-cyan-400',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Well-known severity/priority values get fixed colors.
 */
const KNOWN_COLORS: Record<string, string> = {
  P1: 'bg-red-100 text-red-800',
  P2: 'bg-orange-100 text-orange-800',
  P3: 'bg-yellow-100 text-yellow-800',
  P4: 'bg-primary/10 text-primary',
  critical: 'bg-red-100 text-red-800',
  at_risk: 'bg-orange-100 text-orange-800',
  attention: 'bg-yellow-100 text-yellow-800',
  healthy: 'bg-green-100 text-green-800',
  active: 'bg-green-100 text-green-800',
  resolved: 'bg-gray-100 text-gray-800',
  false_positive: 'bg-gray-100 text-gray-600',
  immediate: 'bg-red-100 text-red-800',
  soon: 'bg-yellow-100 text-yellow-800',
  when_convenient: 'bg-primary/10 text-primary',
};

export interface EnumBadgeProps {
  value: string;
  className?: string;
}

export function EnumBadge({ value, className }: EnumBadgeProps) {
  const colorClass = KNOWN_COLORS[value] ?? ENUM_COLORS[hashString(value) % ENUM_COLORS.length];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        colorClass,
        className,
      )}
    >
      {value}
    </span>
  );
}
