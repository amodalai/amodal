/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';

interface ConnectionItem {
  name: string;
  label: string;
  auth_type: 'api_key' | 'oauth' | 'none';
  env_var?: string;
  description?: string;
  link?: string;
  status: 'pending' | 'connected' | 'skipped';
}

export interface SetupConnectionsBlock {
  type: 'setup_connections';
  connections: ConnectionItem[];
}

interface Props {
  block: SetupConnectionsBlock;
  serverUrl: string;
  sendMessage?: (text: string) => void;
}

/**
 * Renders all connection credentials in a single card with individual
 * input rows and a Continue button at the bottom. Saves go silently
 * to /api/secrets — no chat messages per credential. Only the
 * Continue button sends a message to advance the flow.
 */
export function SetupConnectionsCard({ block, serverUrl, sendMessage }: Props) {
  const [statuses, setStatuses] = useState<Record<string, 'pending' | 'saving' | 'connected' | 'skipped'>>(
    () => Object.fromEntries(block.connections.map((c) => [c.label, c.status])),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const handleSave = async (envVar: string): Promise<void> => {
    const value = values[envVar]?.trim();
    if (!value) return;
    setStatuses((s) => ({ ...s, [envVar]: 'saving' }));
    setErrors((e) => ({ ...e, [envVar]: '' }));
    try {
      const res = await fetch(
        `${serverUrl}/api/secrets/${encodeURIComponent(envVar)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${String(res.status)}${text ? ` — ${text}` : ''}`);
      }
      setStatuses((s) => ({ ...s, [envVar]: 'connected' }));
    } catch (err) {
      setErrors((e) => ({ ...e, [envVar]: err instanceof Error ? err.message : String(err) }));
      setStatuses((s) => ({ ...s, [envVar]: 'pending' }));
    }
  };

  const handleSkip = (envVar: string): void => {
    setStatuses((s) => ({ ...s, [envVar]: 'skipped' }));
  };

  const handleContinue = (): void => {
    setDone(true);
    const connected = Object.values(statuses).filter((s) => s === 'connected').length;
    const skipped = Object.values(statuses).filter((s) => s === 'skipped' || s === 'pending').length;
    sendMessage?.(`Connections configured: ${String(connected)} connected, ${String(skipped)} skipped`);
  };

  if (done) {
    const connected = Object.entries(statuses).filter(([, s]) => s === 'connected');
    const skipped = Object.entries(statuses).filter(([, s]) => s === 'skipped' || s === 'pending');
    return (
      <div className="pcw-setup-connections pcw-setup-connections--done">
        {connected.map(([name]) => (
          <div key={name} className="pcw-setup-connections__row--done">✓ {name}</div>
        ))}
        {skipped.map(([name]) => (
          <div key={name} className="pcw-setup-connections__row--skipped">○ {name} — skipped</div>
        ))}
      </div>
    );
  }

  const allAddressed = Object.values(statuses).every((s) => s === 'connected' || s === 'skipped');

  return (
    <div className="pcw-setup-connections">
      <div className="pcw-setup-connections__title">Connect your accounts</div>
      {block.connections.map((conn) => {
        const envVar = conn.label;
        const status = statuses[envVar] ?? 'pending';
        if (status === 'connected') {
          return (
            <div key={envVar} className="pcw-setup-connections__row pcw-setup-connections__row--connected">
              <span className="pcw-setup-connections__check">✓</span>
              <span className="pcw-setup-connections__name">{conn.name}</span>
            </div>
          );
        }
        if (status === 'skipped') {
          return (
            <div key={envVar} className="pcw-setup-connections__row pcw-setup-connections__row--skipped">
              <span className="pcw-setup-connections__check">○</span>
              <span className="pcw-setup-connections__name">{conn.name} — skipped</span>
            </div>
          );
        }
        return (
          <div key={envVar} className="pcw-setup-connections__row">
            <div className="pcw-setup-connections__header">
              <span className="pcw-setup-connections__name">{conn.name}</span>
              {conn.description && (
                <span className="pcw-setup-connections__desc">
                  {conn.description}
                  {conn.link && (
                    <> <a href={conn.link} target="_blank" rel="noopener noreferrer" className="pcw-setup-connections__link">Open →</a></>
                  )}
                </span>
              )}
            </div>
            <div className="pcw-setup-connections__input-row">
              <input
                type="password"
                className="pcw-setup-connections__input"
                placeholder={envVar}
                value={values[envVar] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [envVar]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(envVar); }}
              />
              <button
                className="pcw-setup-connections__save"
                onClick={() => void handleSave(envVar)}
                disabled={!values[envVar]?.trim() || status === 'saving'}
              >
                {status === 'saving' ? '...' : 'Save'}
              </button>
              <button className="pcw-setup-connections__skip" onClick={() => handleSkip(envVar)}>
                Later
              </button>
            </div>
            {errors[envVar] && <div className="pcw-setup-connections__error">{errors[envVar]}</div>}
          </div>
        );
      })}
      <button
        className="pcw-setup-connections__continue"
        onClick={handleContinue}
        disabled={!allAddressed}
      >
        {allAddressed ? 'Continue →' : `${Object.values(statuses).filter((s) => s === 'connected' || s === 'skipped').length}/${block.connections.length} — fill in or skip all to continue`}
      </button>
    </div>
  );
}
