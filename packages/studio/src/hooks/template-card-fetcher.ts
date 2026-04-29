/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { AgentCard, AgentCardPreview, AgentCardTurn } from '@amodalai/types';

const CARD_TIMEOUT_MS = 5_000;

/**
 * Fetch a template's `card/card.json` from GitHub raw. Returns null on any
 * fetch / parse / validation failure — gallery surfaces silently drop
 * cardless templates rather than rendering broken slots.
 */
export async function fetchAgentCard(
  githubRepo: string,
  branch: string,
): Promise<AgentCard | null> {
  return fetchAndValidate(githubRepo, branch, 'card.json', parseCard);
}

/** Fetch a template's `card/preview.json`. Same failure semantics as `fetchAgentCard`. */
export async function fetchAgentCardPreview(
  githubRepo: string,
  branch: string,
): Promise<AgentCardPreview | null> {
  return fetchAndValidate(githubRepo, branch, 'preview.json', parsePreview);
}

async function fetchAndValidate<T>(
  githubRepo: string,
  branch: string,
  filename: 'card.json' | 'preview.json',
  parse: (raw: unknown) => T | null,
): Promise<T | null> {
  const url = `https://raw.githubusercontent.com/${githubRepo}/${branch}/card/${filename}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CARD_TIMEOUT_MS) });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    return parse(raw);
  } catch {
    return null;
  }
}

/**
 * Lightweight shape check for `card.json`. Mirrors `AgentCardSchema` from
 * `@amodalai/core`, but inlined because core's loader pulls in `node:fs`
 * and isn't browser-safe.
 */
export function parseCard(raw: unknown): AgentCard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON from GitHub raw
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || obj.title === '') return null;
  if (typeof obj.tagline !== 'string' || obj.tagline === '') return null;

  const platforms = readStringArray(obj.platforms);
  const turns = readTurns(obj.thumbnailConversation) ?? [];

  const snippet =
    typeof obj.snippet === 'string' && obj.snippet !== '' ? obj.snippet : undefined;
  const uses =
    typeof obj.uses === 'number' && Number.isFinite(obj.uses) && obj.uses >= 0
      ? Math.floor(obj.uses)
      : undefined;

  return {
    title: obj.title,
    tagline: obj.tagline,
    platforms,
    thumbnailConversation: turns,
    ...(snippet !== undefined ? { snippet } : {}),
    ...(uses !== undefined ? { uses } : {}),
  };
}

/** Lightweight shape check for `preview.json`. */
export function parsePreview(raw: unknown): AgentCardPreview | null {
  if (typeof raw !== 'object' || raw === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON from GitHub raw
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || obj.title === '') return null;
  if (typeof obj.description !== 'string' || obj.description === '') return null;

  const platforms = readStringArray(obj.platforms);
  const turns = readTurns(obj.conversation);
  if (turns === null || turns.length === 0) return null;

  return {
    title: obj.title,
    description: obj.description,
    platforms,
    conversation: turns,
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function readTurns(value: unknown): AgentCardTurn[] | null {
  if (!Array.isArray(value)) return null;
  const turns: AgentCardTurn[] = [];
  for (const t of value) {
    if (typeof t !== 'object' || t === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON from GitHub raw
    const turn = t as Record<string, unknown>;
    if (turn.role !== 'user' && turn.role !== 'agent') return null;
    if (typeof turn.content !== 'string' || turn.content === '') return null;
    turns.push({ role: turn.role, content: turn.content });
  }
  return turns;
}
