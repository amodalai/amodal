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
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-yellow-100 text-yellow-800',
  'bg-red-100 text-red-800',
  'bg-purple-100 text-purple-800',
  'bg-pink-100 text-pink-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
  'bg-cyan-100 text-cyan-800',
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
  P4: 'bg-blue-100 text-blue-800',
  critical: 'bg-red-100 text-red-800',
  at_risk: 'bg-orange-100 text-orange-800',
  attention: 'bg-yellow-100 text-yellow-800',
  healthy: 'bg-green-100 text-green-800',
  active: 'bg-green-100 text-green-800',
  resolved: 'bg-gray-100 text-gray-800',
  false_positive: 'bg-gray-100 text-gray-600',
  immediate: 'bg-red-100 text-red-800',
  soon: 'bg-yellow-100 text-yellow-800',
  when_convenient: 'bg-blue-100 text-blue-800',
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
