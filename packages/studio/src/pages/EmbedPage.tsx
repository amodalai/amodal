/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo, useState } from 'react';
import { AgentOffline } from '@/components/AgentOffline';
import { useStudioConfig } from '@/contexts/StudioConfigContext';
import { useEmbedConfig } from '@/hooks/useEmbedConfig';
import type { EmbedConfig } from '@/lib/embed-config';
import { buildEmbedSnippet, EMBED_POSITIONS, EMBED_SCOPE_MODES } from '@/lib/embed-config';
import { Bot, Check, Copy, History, MessageCircle, Save, ThumbsDown, ThumbsUp, Wrench } from 'lucide-react';

function cloneConfig(config: EmbedConfig): EmbedConfig {
  return {
    ...config,
    allowedDomains: [...config.allowedDomains],
    theme: { ...config.theme },
  };
}

function updateTheme(config: EmbedConfig, key: keyof EmbedConfig['theme'], value: string): EmbedConfig {
  return { ...config, theme: { ...config.theme, [key]: value } };
}

class EmbedConfigSaveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmbedConfigSaveError';
  }
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2 text-sm">
      <span className="text-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

function EmbedPreview({
  config,
  domains,
}: {
  config: EmbedConfig;
  domains: string[];
}) {
  const isFloatingClosed = config.position === 'floating' && !config.defaultOpen;
  const previewDomain = domains[0] ?? 'app.example.com';
  const shellClass = config.theme.mode === 'dark'
    ? 'bg-slate-950 text-slate-100'
    : 'bg-slate-50 text-slate-950';
  const panelClass = config.theme.mode === 'dark'
    ? 'border-slate-800 bg-slate-900 text-slate-100 shadow-2xl'
    : 'border-slate-200 bg-white text-slate-950 shadow-xl';
  const mutedClass = config.theme.mode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const subtleClass = config.theme.mode === 'dark' ? 'bg-slate-800' : 'bg-slate-100';

  const placementClass = (() => {
    switch (config.position) {
      case 'right':
        return 'items-stretch justify-end';
      case 'bottom':
        return 'items-end justify-center';
      case 'inline':
        return 'items-center justify-center';
      case 'floating':
        return 'items-end justify-end';
      default: {
        const _exhaustive: never = config.position;
        return _exhaustive;
      }
    }
  })();

  const panelSizeClass = (() => {
    switch (config.position) {
      case 'right':
        return 'h-full w-[320px] rounded-none border-y-0 border-r-0';
      case 'bottom':
        return 'h-[330px] w-full rounded-t-lg border-b-0';
      case 'inline':
        return 'h-[430px] w-full max-w-[320px] rounded-lg';
      case 'floating':
        return 'h-[430px] w-[320px] rounded-lg';
      default: {
        const _exhaustive: never = config.position;
        return _exhaustive;
      }
    }
  })();

  return (
    <div className={`relative flex h-[560px] overflow-hidden rounded-lg border border-border ${shellClass}`}>
      <div className="absolute inset-0 p-4">
        <div className="mb-4 flex items-center justify-between border-b border-current/10 pb-3">
          <div>
            <div className="text-sm font-semibold">Acme customer portal</div>
            <div className={`text-xs ${mutedClass}`}>{previewDomain}</div>
          </div>
          <div className={`rounded-md px-2 py-1 text-xs ${subtleClass}`}>
            Orders
          </div>
        </div>
        <div className="grid gap-3">
          <div className={`rounded-md p-3 ${subtleClass}`}>
            <div className="text-xs font-medium">Order CM-1042</div>
            <div className={`mt-1 text-xs ${mutedClass}`}>Campaign assets queued for publishing.</div>
          </div>
          <div className={`rounded-md p-3 ${subtleClass}`}>
            <div className="text-xs font-medium">Recent activity</div>
            <div className={`mt-1 text-xs ${mutedClass}`}>3 Typefully drafts, 1 Dev.to article.</div>
          </div>
        </div>
      </div>

      {!config.enabled && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80">
          <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            Widget disabled
          </div>
        </div>
      )}

      <div className={`relative z-10 flex h-full w-full p-4 ${placementClass}`}>
        {isFloatingClosed ? (
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg"
            style={{ backgroundColor: config.theme.primaryColor }}
            aria-label={config.theme.headerText}
          >
            <MessageCircle className="h-5 w-5" />
          </button>
        ) : (
          <div className={`flex flex-col overflow-hidden border ${panelClass} ${panelSizeClass}`}>
            <div className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: config.theme.primaryColor }}
              >
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{config.theme.headerText}</div>
                <div className={`truncate text-xs ${mutedClass}`}>
                  {config.scopeMode === 'required' ? 'Scoped to tenant-acme' : 'Shared support session'}
                </div>
              </div>
              {config.historyEnabled && <History className={`h-4 w-4 ${mutedClass}`} />}
            </div>

            <div className="flex-1 space-y-3 overflow-hidden px-3 py-3 text-sm">
              {config.historyEnabled && (
                <div className={`rounded-md px-2 py-1 text-xs ${subtleClass}`}>
                  Previous sessions visible
                </div>
              )}
              <div className="ml-auto max-w-[82%] rounded-lg px-3 py-2 text-white" style={{ backgroundColor: config.theme.primaryColor }}>
                Which posts are queued for today?
              </div>
              <div className={`max-w-[88%] rounded-lg px-3 py-2 ${subtleClass}`}>
                I found 3 queued Typefully drafts and 1 Dev.to article. The next post is scheduled for 2:30 PM.
              </div>
              <div className={`max-w-[88%] rounded-md border border-current/10 px-3 py-2 text-xs ${subtleClass}`}>
                <div className="flex items-center gap-2 font-medium">
                  <Wrench className="h-3.5 w-3.5" />
                  get_typefully_queue
                </div>
                {config.verboseTools && (
                  <div className={`mt-2 space-y-1 font-mono ${mutedClass}`}>
                    <div>status: 200</div>
                    <div>items: 3</div>
                    <div>duration: 184ms</div>
                  </div>
                )}
              </div>
              <div className={`max-w-[88%] rounded-lg px-3 py-2 ${subtleClass}`}>
                Want me to turn the highest-performing draft into a Dev.to post?
                {config.showFeedback && (
                  <div className={`mt-2 flex items-center gap-2 ${mutedClass}`}>
                    <ThumbsUp className="h-3.5 w-3.5" />
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-current/10 p-3">
              <div className={`rounded-md border border-current/10 px-3 py-2 text-xs ${mutedClass}`}>
                {config.theme.placeholder}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EmbedPage() {
  const { runtimeUrl } = useStudioConfig();
  const { config, source, snippet, loading, saving, error, saveError, save } = useEmbedConfig();
  const [draft, setDraft] = useState<EmbedConfig | null>(null);
  const [domainText, setDomainText] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setDraft(cloneConfig(config));
      setDomainText(config.allowedDomains.join('\n'));
    }
  }, [config]);

  const generatedSnippet = useMemo(() => {
    if (!draft) return snippet;
    return buildEmbedSnippet({ config: draft, serverUrl: runtimeUrl });
  }, [draft, runtimeUrl, snippet]);

  if (error) return <AgentOffline page="embed" detail={error} />;
  if (loading || !draft) return null;

  const normalizedDomains = domainText
    .split('\n')
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const isDirty = config
    ? JSON.stringify({ ...draft, allowedDomains: normalizedDomains }) !== JSON.stringify(config)
    : false;

  const update = (next: EmbedConfig) => {
    setSaved(false);
    setDraft(next);
  };

  const saveDraft = async () => {
    const next = { ...draft, allowedDomains: normalizedDomains };
    try {
      const response = await save(next);
      setDraft(cloneConfig(response.config));
      setSaved(true);
    } catch (err: unknown) {
      if (!(err instanceof Error)) {
        throw new EmbedConfigSaveError('Embed config save failed with a non-Error rejection', { cause: err });
      }
      setSaved(false);
    }
  };

  const copySnippet = async () => {
    await navigator.clipboard.writeText(generatedSnippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Embed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the chat widget your application mounts for this agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void saveDraft(); }}
          disabled={saving || !isDirty}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save draft'}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-medium text-foreground">Widget</h2>
              <p className="text-sm text-muted-foreground">
                These settings are stored under <code className="font-mono">embed</code> in <code className="font-mono">amodal.json</code>.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Position</span>
                <select
                  value={draft.position}
                  onChange={(event) => {
                    const position = EMBED_POSITIONS.find((entry) => entry === event.target.value) ?? draft.position;
                    update({ ...draft, position });
                  }}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"
                >
                  {EMBED_POSITIONS.map((position) => (
                    <option key={position} value={position}>{position}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Scope</span>
                <select
                  value={draft.scopeMode}
                  onChange={(event) => {
                    const scopeMode = EMBED_SCOPE_MODES.find((entry) => entry === event.target.value) ?? draft.scopeMode;
                    update({ ...draft, scopeMode });
                  }}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"
                >
                  {EMBED_SCOPE_MODES.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow label="Enabled" checked={draft.enabled} onChange={(enabled) => update({ ...draft, enabled })} />
              <ToggleRow label="Open by default" checked={draft.defaultOpen} onChange={(defaultOpen) => update({ ...draft, defaultOpen })} />
              <ToggleRow label="Session history" checked={draft.historyEnabled} onChange={(historyEnabled) => update({ ...draft, historyEnabled })} />
              <ToggleRow label="Feedback buttons" checked={draft.showFeedback} onChange={(showFeedback) => update({ ...draft, showFeedback })} />
              <ToggleRow label="Verbose tools" checked={draft.verboseTools} onChange={(verboseTools) => update({ ...draft, verboseTools })} />
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-foreground">Theme</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Header</span>
                <input
                  value={draft.theme.headerText}
                  onChange={(event) => update(updateTheme(draft, 'headerText', event.target.value))}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Placeholder</span>
                <input
                  value={draft.theme.placeholder}
                  onChange={(event) => update(updateTheme(draft, 'placeholder', event.target.value))}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Empty state</span>
                <input
                  value={draft.theme.emptyStateText}
                  onChange={(event) => update(updateTheme(draft, 'emptyStateText', event.target.value))}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Primary color</span>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={draft.theme.primaryColor}
                    onChange={(event) => update(updateTheme(draft, 'primaryColor', event.target.value))}
                    className="h-10 w-12 rounded-md border border-border bg-card"
                  />
                  <input
                    value={draft.theme.primaryColor}
                    onChange={(event) => update(updateTheme(draft, 'primaryColor', event.target.value))}
                    className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-foreground"
                  />
                </div>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Mode</span>
                <select
                  value={draft.theme.mode}
                  onChange={(event) => update(updateTheme(draft, 'mode', event.target.value))}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"
                >
                  <option value="auto">auto</option>
                  <option value="light">light</option>
                  <option value="dark">dark</option>
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium text-foreground">Allowed domains</h2>
              <p className="text-sm text-muted-foreground">One domain per line. Leave empty to allow any domain.</p>
            </div>
            <textarea
              value={domainText}
              onChange={(event) => {
                setSaved(false);
                setDomainText(event.target.value);
              }}
              rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
              placeholder="app.example.com"
            />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-foreground">React snippet</h2>
                <p className="text-sm text-muted-foreground">Use this in the host app after publishing the draft.</p>
              </div>
              <button
                type="button"
                onClick={() => { void copySnippet(); }}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-auto rounded-md border border-border bg-muted p-4 text-xs text-foreground">
              <code>{generatedSnippet}</code>
            </pre>
          </section>

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          {saved && <p className="text-sm text-muted-foreground">Saved as an <code className="font-mono">amodal.json</code> draft.</p>}
          {source && <p className="text-xs text-muted-foreground">Current source: {source}</p>}
        </div>

        <aside className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">Preview</h2>
          <EmbedPreview config={{ ...draft, allowedDomains: normalizedDomains }} domains={normalizedDomains} />
        </aside>
      </div>
    </div>
  );
}
