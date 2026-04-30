/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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

const TEMPLATES = [
  { repo: 'amodalai/template-content-marketing', branch: 'main' },
  { repo: 'amodalai/template-support-triage', branch: 'main' },
  { repo: 'amodalai/template-sales-pipeline', branch: 'main' },
];

// ---------------------------------------------------------------------------
// Wizard — vertical chat-like flow
// ---------------------------------------------------------------------------

export function OnboardingWizard() {
  const { runtimeUrl } = useStudioConfig();
  const [step, setStep] = useState<WizardStep>('gallery');
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [credentials, setCredentials] = useState<ConnectionCredential[]>([]);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [credErrors, setCredErrors] = useState<Record<string, string>>({});
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [companyUrl, setCompanyUrl] = useState('');
  const [companyDesc, setCompanyDesc] = useState('');
  const [summaryData, setSummaryData] = useState<{name: string; connections: Array<{name: string; status: string}>; customizeContext?: string} | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on step change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [step]);

  // Open admin chat panel and send seed message when reaching summary
  useEffect(() => {
    if (step !== 'summary' || !summaryData) return;

    // Clear persisted admin chat so a fresh session is created with current tools
    try { localStorage.removeItem('amodal-admin-chat-v2'); } catch { /* */ }

    const seed = summaryData.customizeContext
      ? `I just set up a ${summaryData.name} agent. Here's my company info:\n\n${summaryData.customizeContext}\n\nFetch my website using fetch_url to understand what we do. Then write a brand-context knowledge doc (knowledge/brand-context.md) that captures our voice, target audience, and content themes.`
      : `I just set up a ${summaryData.name} agent. Review the installed skills and knowledge and help me customize it.`;

    window.dispatchEvent(new CustomEvent('admin-chat-open', { detail: seed }));
  }, [step, summaryData]);

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

  const handleClone = useCallback(async (repo: string, branch: string, name: string) => {
    setSelectedName(name);
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
        throw new Error(`${String(res.status)} ${body}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
      const data = (await res.json()) as { credentials: ConnectionCredential[] };
      setCredentials(data.credentials);
      setStep(data.credentials.length > 0 ? 'credentials' : 'customize');
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
      setStep('gallery');
    }
  }, []);

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
  }, [credValues]);

  const handleSkipCredential = useCallback((envVar: string) => {
    setCredentials((prev) => prev.map((c) => c.envVar === envVar ? { ...c, status: 'skipped' } : c));
  }, []);

  const handleCustomize = useCallback(() => {
    // Seed the admin chat with the customize context. The agent
    // will write the actual knowledge doc using file tools.
    const context = [
      companyUrl.trim() ? `Website: ${companyUrl.trim()}` : '',
      companyDesc.trim() ? companyDesc.trim() : '',
    ].filter(Boolean).join('\n');

    setSummaryData({
      name: selectedName || 'Your agent',
      connections: credentials.map((c) => ({ name: c.name, status: c.status === 'connected' ? 'connected' : 'pending' })),
      customizeContext: context || undefined,
    });
    setStep('summary');
  }, [companyUrl, companyDesc, selectedName, credentials]);

  const allCredsAddressed = credentials.every((c) => c.status === 'connected' || c.status === 'skipped');
  const pastGallery = step !== 'gallery';
  const pastCloning = step !== 'gallery' && step !== 'cloning';
  const pastCredentials = step === 'customize' || step === 'summary';
  const pastCustomize = step === 'summary';

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

      {/* ---- GALLERY ---- */}
      {!pastGallery ? (
        <>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Start with an agent</h2>
            <p className="text-sm text-muted-foreground">Pick a template to get started, or build something custom.</p>
          </div>
          {cloneError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{cloneError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => t.card ? (
              <PickerCard key={t.repo} card={t.card} author={t.card.author ?? ''} verified={true}
                onClick={() => void handleClone(t.repo, t.branch, t.card?.title ?? t.repo)} />
            ) : (
              <div key={t.repo} className="border border-border rounded-lg p-4 animate-pulse bg-card h-32" />
            ))}
          </div>
          <button className="text-sm text-primary hover:underline" onClick={() => { /* TODO: open admin chat */ }}>
            Build custom →
          </button>
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="text-emerald-500">✓</span> {selectedName}
        </div>
      )}

      {/* ---- CLONING ---- */}
      {step === 'cloning' && (
        <div className="flex items-center gap-3 py-4">
          <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm text-muted-foreground">Setting up {selectedName}...</span>
        </div>
      )}

      {/* ---- CREDENTIALS ---- */}
      {pastCloning && credentials.length > 0 && !pastCredentials ? (
        <>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Connect your accounts</h2>
            <p className="text-sm text-muted-foreground">Add API keys or skip for now.</p>
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
                  <div className="text-sm text-muted-foreground">○ {cred.name} — skipped</div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium text-foreground">{cred.name}</span>
                      {cred.description && <span className="text-xs text-muted-foreground ml-2">{cred.description}</span>}
                    </div>
                    <div className="flex gap-2">
                      <input type="password"
                        className="flex-1 px-3 py-1.5 text-xs font-mono border border-border rounded bg-background text-foreground outline-none focus:border-primary"
                        placeholder={cred.envVar}
                        value={credValues[cred.envVar] ?? ''}
                        onChange={(e) => setCredValues((v) => ({ ...v, [cred.envVar]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveCredential(cred.envVar); }}
                      />
                      <button className="px-3 py-1.5 text-xs font-medium text-white bg-primary-solid rounded hover:opacity-90 disabled:opacity-50"
                        onClick={() => void handleSaveCredential(cred.envVar)}
                        disabled={!credValues[cred.envVar]?.trim() || cred.status === 'saving'}>
                        {cred.status === 'saving' ? '...' : 'Save'}
                      </button>
                      <button className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded hover:text-foreground"
                        onClick={() => handleSkipCredential(cred.envVar)}>Later</button>
                    </div>
                    {credErrors[cred.envVar] && <p className="text-xs text-destructive">{credErrors[cred.envVar]}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="w-full py-2 text-sm font-medium text-white bg-primary-solid rounded-lg hover:opacity-90 disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground"
            onClick={() => setStep('customize')} disabled={!allCredsAddressed}>
            {allCredsAddressed ? 'Continue →' : `${credentials.filter((c) => c.status !== 'pending' && c.status !== 'saving').length}/${credentials.length} — address all to continue`}
          </button>
        </>
      ) : pastCredentials && credentials.length > 0 ? (
        <div className="text-sm text-muted-foreground space-y-0.5">
          {credentials.map((c) => (
            <div key={c.envVar} className={c.status === 'connected' ? 'text-emerald-500' : ''}>
              {c.status === 'connected' ? '✓' : '○'} {c.name}
            </div>
          ))}
        </div>
      ) : null}

      {/* ---- CUSTOMIZE ---- */}
      {pastCloning && !pastCustomize && step === 'customize' ? (
        <>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Personalize your agent</h2>
            <p className="text-sm text-muted-foreground">Help your agent create relevant content.</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Website URL</label>
              <input type="url" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:border-primary"
                placeholder="https://example.com" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">What does your company do?</label>
              <textarea className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:border-primary resize-none"
                placeholder="We build developer tools for..." rows={2} value={companyDesc} onChange={(e) => setCompanyDesc(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3">
            <button className="flex-1 py-2 text-sm font-medium text-white bg-primary-solid rounded-lg hover:opacity-90"
              onClick={() => void handleCustomize()}>Continue →</button>
            <button className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:text-foreground"
              onClick={() => { setSummaryData({ name: selectedName || 'Your agent', connections: credentials.map((c) => ({ name: c.name, status: c.status === 'connected' ? 'connected' : 'pending' })) }); setStep('summary'); }}>
              Skip
            </button>
          </div>
        </>
      ) : pastCustomize && (companyUrl || companyDesc) ? (
        <div className="text-sm text-muted-foreground">✓ Brand context saved</div>
      ) : null}

      {/* ---- SUMMARY + ADMIN CHAT ---- */}
      {step === 'summary' && summaryData && (
        <>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{summaryData.name} is ready!</h2>
            <div className="space-y-1">
              {summaryData.connections.map((c) => (
                <div key={c.name} className={`text-sm ${c.status === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {c.status === 'connected' ? '✓' : '○'} {c.name}
                </div>
              ))}
            </div>
            <a href={runtimeUrl} target="_blank" rel="noopener noreferrer"
              className="inline-block px-5 py-2 text-sm font-medium text-white bg-primary-solid rounded-lg hover:opacity-90">
              Open agent →
            </a>
          </div>
          <div className="flex items-center gap-3 py-2">
            <span className="text-primary">→</span>
            <p className="text-sm text-muted-foreground">
              The admin agent is personalizing your setup in the chat panel.
            </p>
          </div>
        </>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
