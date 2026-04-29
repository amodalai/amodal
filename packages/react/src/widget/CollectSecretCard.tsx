/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { CollectSecretBlock } from '../types';

interface Props {
  block: CollectSecretBlock;
  /** Runtime URL for POSTing the secret value. */
  serverUrl: string;
  /** Called after save to continue the chat flow. */
  sendMessage?: (text: string) => void;
  /** Dispatch to update block status. */
  onSaved?: (secretId: string) => void;
}

/**
 * Inline API key input form. The secret value goes directly to
 * /api/secrets via browser fetch — never sent to the LLM.
 */
export function CollectSecretCard({ block, serverUrl, onSaved }: Props) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (block.status === 'saved') {
    return (
      <div className="pcw-collect-secret pcw-collect-secret--saved">
        <div className="pcw-collect-secret__label">✓ {block.label}</div>
      </div>
    );
  }

  if (block.status === 'skipped') {
    return (
      <div className="pcw-collect-secret pcw-collect-secret--skipped">
        <div className="pcw-collect-secret__label">{block.label} — skipped</div>
      </div>
    );
  }

  const handleSave = async (): Promise<void> => {
    if (!value.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${serverUrl}/api/secrets/${encodeURIComponent(block.name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: value.trim() }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Save failed: ${String(res.status)}${text ? ` — ${text}` : ''}`);
      }
      onSaved?.(block.secretId);
      // Don't send a chat message — just update the card UI silently.
      // The agent doesn't need to know about each credential individually.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const handleSkip = (): void => {
    onSaved?.(block.secretId);
    // Silent skip — no chat message. The agent continues when the user
    // clicks a "Continue" button on the setup_connections card.
  };

  return (
    <div className="pcw-collect-secret">
      <div className="pcw-collect-secret__label">{block.label}</div>
      {block.description && (
        <div className="pcw-collect-secret__description">
          {block.description}
          {block.link && (
            <>
              {' '}
              <a href={block.link} target="_blank" rel="noopener noreferrer" className="pcw-collect-secret__link">
                Open →
              </a>
            </>
          )}
        </div>
      )}
      <div className="pcw-collect-secret__input-row">
        <input
          type="password"
          className="pcw-collect-secret__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={block.name}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
        />
      </div>
      {error && <div className="pcw-collect-secret__error">{error}</div>}
      <div className="pcw-collect-secret__actions">
        <button
          className="pcw-collect-secret__save"
          onClick={() => void handleSave()}
          disabled={!value.trim() || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="pcw-collect-secret__skip" onClick={handleSkip}>
          Later
        </button>
      </div>
    </div>
  );
}
