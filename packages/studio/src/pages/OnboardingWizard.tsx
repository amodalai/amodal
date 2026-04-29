/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import type { AgentCard } from '@amodalai/types';
import { PickerCard } from '@/components/PickerCard';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { fetchAgentCard } from '../hooks/template-card-fetcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateInfo {
  repo: string;
  branch: string;
  card: AgentCard | null;
}

interface ConnectionCredential {
  name: string;
  envVar: string;
  description: string;
  status: 'pending' | 'saving' | 'connected' | 'skipped';
}

type WizardStep = 'gallery' | 'cloning' | 'credentials' | 'customize' | 'summary';

// ---------------------------------------------------------------------------
// Template catalog
// ---------------------------------------------------------------------------

const TEMPLATES = [
  { repo: 'amodalai/template-content-marketing', branch: 'main' },
  { repo: 'amodalai/template-support-triage', branch: 'main' },
  { repo: 'amodalai/template-sales-pipeline', branch: 'main' },
];

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

export function OnboardingWizard() {
  const { runtimeUrl } = useStudioConfig();
  const [step, setStep] = useState<WizardStep>('gallery');
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [_selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ConnectionCredential[]>([]);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [credErrors, setCredErrors] = useState<Record<string, string>>({});
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [companyUrl, setCompanyUrl] = useState('');
  const [companyDesc, setCompanyDesc] = useState('');
  const [summaryData, setSummaryData] = useState<{name: string; connections: Array<{name: string; status: string}>; agentUrl: string} | null>(null);

  // Fetch template cards on mount
  useEffect(() => {
    void (async () => {
      const results: TemplateInfo[] = [];
      for (const t of TEMPLATES) {
        const card = await fetchAgentCard(t.repo, t.branch);
        results.push({ ...t, card });
      }
      setTemplates(results);
    })();
  }, []);

  // ----- CLONE -----
  const handleClone = useCallback(async (repo: string, branch: string) => {
    setSelectedTemplate(repo);
    setStep('cloning');
    setCloneError(null);

    try {
      const res = await fetch(`/api/studio/onboarding/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, branch }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Clone failed: ${String(res.status)} ${body}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
      const data = (await res.json()) as { credentials: ConnectionCredential[] };
      setCredentials(data.credentials);
      setStep('credentials');
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
      setStep('gallery');
    }
  }, [runtimeUrl]);

  // ----- SAVE CREDENTIAL -----
  const handleSaveCredential = useCallback(async (envVar: string) => {
    const value = credValues[envVar]?.trim();
    if (!value) return;
    setCredentials((prev) => prev.map((c) => c.envVar === envVar ? { ...c, status: 'saving' } : c));
    setCredErrors((prev) => ({ ...prev, [envVar]: '' }));
    try {
      const res = await fetch(`/api/studio/onboarding/save-secret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: envVar, value }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Save failed: ${String(res.status)}`);
      setCredentials((prev) => prev.map((c) => c.envVar === envVar ? { ...c, status: 'connected' } : c));
    } catch (err) {
      setCredErrors((prev) => ({ ...prev, [envVar]: err instanceof Error ? err.message : String(err) }));
      setCredentials((prev) => prev.map((c) => c.envVar === envVar ? { ...c, status: 'pending' } : c));
    }
  }, [runtimeUrl, credValues]);

  const handleSkipCredential = useCallback((envVar: string) => {
    setCredentials((prev) => prev.map((c) => c.envVar === envVar ? { ...c, status: 'skipped' } : c));
  }, []);

  // ----- CUSTOMIZE -----
  const handleCustomize = useCallback(async () => {
    if (companyUrl.trim() || companyDesc.trim()) {
      // Write a simple brand context knowledge doc
      const content = [
        '# Brand Context',
        '',
        companyUrl.trim() ? `Website: ${companyUrl.trim()}` : '',
        companyDesc.trim() ? `\n${companyDesc.trim()}` : '',
      ].filter(Boolean).join('\n');

      try {
        await fetch(`${runtimeUrl}/api/files/knowledge/brand-context.md`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: content,
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Non-fatal — customize is optional
      }
    }
    loadSummary();
  }, [runtimeUrl, companyUrl, companyDesc]);

  const handleSkipCustomize = useCallback(() => {
    loadSummary();
  }, []);

  // ----- SUMMARY -----
  const loadSummary = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch(`${runtimeUrl}/api/config`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
          const config = (await res.json()) as { appName?: string; name?: string };
          setSummaryData({
            name: config.appName ?? config.name ?? 'Your agent',
            connections: credentials.map((c) => ({ name: c.name, status: c.status === 'connected' ? 'connected' : 'pending' })),
            agentUrl: runtimeUrl,
          });
        }
      } catch { /* */ }
      setStep('summary');
    })();
  }, [runtimeUrl, credentials]);

  // ----- RENDER -----

  if (step === 'gallery') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Start with an agent</h1>
          <p className="text-sm text-muted-foreground mt-1">Pick a template to get started, or build something custom.</p>
        </div>
        {cloneError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {cloneError}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => t.card ? (
            <PickerCard
              key={t.repo}
              card={t.card}
              author={t.card.author ?? t.repo.split('/')[0]}
              verified={true}
              onClick={() => void handleClone(t.repo, t.branch)}
            />
          ) : (
            <div key={t.repo} className="border border-border rounded-lg p-4 animate-pulse bg-card h-40" />
          ))}
        </div>
        <button
          className="text-sm text-primary hover:underline"
          onClick={() => {
            // TODO: open admin chat for custom build
          }}
        >
          Build custom →
        </button>
      </div>
    );
  }

  if (step === 'cloning') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col items-center justify-center gap-4">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        <p className="text-sm text-muted-foreground">Setting up your agent...</p>
      </div>
    );
  }

  if (step === 'credentials') {
    const allAddressed = credentials.every((c) => c.status === 'connected' || c.status === 'skipped');
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Connect your accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">Add your API keys to enable connections. You can skip any and add them later.</p>
        </div>
        <div className="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border">
          {credentials.map((cred) => (
            <div key={cred.envVar} className="px-4 py-3">
              {cred.status === 'connected' ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-emerald-500">✓</span>
                  <span className="font-medium text-foreground">{cred.name}</span>
                </div>
              ) : cred.status === 'skipped' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>○</span>
                  <span>{cred.name} — skipped</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">{cred.name}</span>
                    {cred.description && <span className="text-xs text-muted-foreground ml-2">{cred.description}</span>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      className="flex-1 px-3 py-1.5 text-xs font-mono border border-border rounded bg-background text-foreground outline-none focus:border-primary"
                      placeholder={cred.envVar}
                      value={credValues[cred.envVar] ?? ''}
                      onChange={(e) => setCredValues((v) => ({ ...v, [cred.envVar]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveCredential(cred.envVar); }}
                    />
                    <button
                      className="px-3 py-1.5 text-xs font-medium text-white bg-primary-solid rounded hover:opacity-90 disabled:opacity-50"
                      onClick={() => void handleSaveCredential(cred.envVar)}
                      disabled={!credValues[cred.envVar]?.trim() || cred.status === 'saving'}
                    >
                      {cred.status === 'saving' ? '...' : 'Save'}
                    </button>
                    <button
                      className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded hover:text-foreground"
                      onClick={() => handleSkipCredential(cred.envVar)}
                    >
                      Later
                    </button>
                  </div>
                  {credErrors[cred.envVar] && (
                    <p className="text-xs text-destructive">{credErrors[cred.envVar]}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          className="w-full py-2.5 text-sm font-medium text-white bg-primary-solid rounded-lg hover:opacity-90 disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground"
          onClick={() => setStep('customize')}
          disabled={!allAddressed}
        >
          {allAddressed ? 'Continue →' : `${credentials.filter((c) => c.status === 'connected' || c.status === 'skipped').length}/${credentials.length} — address all to continue`}
        </button>
      </div>
    );
  }

  if (step === 'customize') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Personalize your agent</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Help your agent create relevant content by telling it about your company.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Website URL</label>
            <input
              type="url"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:border-primary"
              placeholder="https://example.com"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">What does your company do?</label>
            <textarea
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:border-primary resize-none"
              placeholder="We build developer tools for..."
              rows={3}
              value={companyDesc}
              onChange={(e) => setCompanyDesc(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            className="flex-1 py-2.5 text-sm font-medium text-white bg-primary-solid rounded-lg hover:opacity-90"
            onClick={() => void handleCustomize()}
          >
            Continue →
          </button>
          <button
            className="px-4 py-2.5 text-sm text-muted-foreground border border-border rounded-lg hover:text-foreground"
            onClick={handleSkipCustomize}
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (step === 'summary') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 space-y-4">
          <h1 className="text-xl font-semibold text-foreground">
            {summaryData?.name ?? 'Your agent'} is ready!
          </h1>
          {summaryData?.connections && summaryData.connections.length > 0 && (
            <div className="space-y-1">
              {summaryData.connections.map((c) => (
                <div key={c.name} className={`text-sm ${c.status === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {c.status === 'connected' ? '✓' : '○'} {c.name}
                </div>
              ))}
            </div>
          )}
          <a
            href={summaryData?.agentUrl ?? runtimeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-5 py-2.5 text-sm font-medium text-white bg-primary-solid rounded-lg hover:opacity-90"
          >
            Start using your agent →
          </a>
        </div>
      </div>
    );
  }

  return null;
}
