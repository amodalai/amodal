/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { PickerCard } from '@/components/PickerCard';
import { AdminChat } from '@/components/views/AdminChat';
import { useTemplateCatalog, type CatalogAgent, type CatalogAgentDetail } from '../hooks/useTemplateCatalog';
import { cn } from '@/lib/utils';

const POPULAR_TAB = 'Popular';
const TAB_ORDER: readonly string[] = [POPULAR_TAB, 'Marketing', 'Sales', 'Support', 'Ops'];
const PICKER_LIMIT = 8;
const SEED_DELAY_MS = 50;

const SUGGESTION_CHIPS: readonly string[] = [
  'Send me a weekly marketing report every Monday',
  'Text customers the day before their appointment',
  'Triage support emails and draft replies from our FAQ',
  'Chase overdue invoices automatically',
  'Summarize new deals in Slack every morning',
];

const ROLES: readonly string[] = [
  'Plumber / Contractor',
  'Electrician',
  'Marketing Manager',
  'Sales Rep',
  'Customer Support',
  'Property Manager',
  'Agency Owner',
  'Freelancer',
  'Operations Manager',
  'Accountant / Bookkeeper',
];

const PAINS: readonly string[] = [
  'Scheduling & appointments',
  'Chasing invoices / payments',
  'Answering the same questions',
  'Manual data entry',
  'Following up with leads',
  'Writing reports',
  'Managing social media',
  'Tracking inventory / supplies',
];

type Mode =
  | { kind: 'pick' }
  | { kind: 'detail'; agent: CatalogAgent }
  | { kind: 'questionnaire' }
  | { kind: 'chat'; title: string; seed: string; from: 'detail' | 'pick' | 'questionnaire'; agent?: CatalogAgent };

/**
 * Empty-repo boot screen — full-screen overlay (the StudioShell sidebar is
 * hidden behind it). Four modes:
 *
 *   - **pick** — tabs + cards + custom textarea + questionnaire link.
 *   - **detail** — rich preview (description, example output, connections,
 *     skills) with a "Set this up" CTA.
 *   - **questionnaire** — 3-step wizard (role / pains / tools) that compiles
 *     into a chat seed for the admin agent.
 *   - **chat** — full-screen AdminChat seeded with the user's intent.
 */
export function CreateFlowPage() {
  const [mode, setMode] = useState<Mode>({ kind: 'pick' });

  const goBack = (): void => {
    if (mode.kind === 'chat') {
      // Back from chat returns to the originating mode where possible
      if (mode.from === 'detail' && mode.agent) {
        setMode({ kind: 'detail', agent: mode.agent });
        return;
      }
      if (mode.from === 'questionnaire') {
        setMode({ kind: 'questionnaire' });
        return;
      }
    }
    setMode({ kind: 'pick' });
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background overflow-hidden">
      <Header
        onBack={mode.kind === 'pick' ? null : goBack}
        showSkip={mode.kind === 'pick'}
      />

      {mode.kind === 'pick' && (
        <PickerView
          onPick={(agent) => setMode({ kind: 'detail', agent })}
          onDescribe={(description) =>
            setMode({
              kind: 'chat',
              title: 'Custom agent',
              seed: description,
              from: 'pick',
            })
          }
          onQuestionnaire={() => setMode({ kind: 'questionnaire' })}
        />
      )}

      {mode.kind === 'detail' && (
        <DetailView
          agent={mode.agent}
          onSetup={() =>
            setMode({
              kind: 'chat',
              title: mode.agent.card.title,
              seed: `Set up the "${mode.agent.card.title}" template.`,
              from: 'detail',
              agent: mode.agent,
            })
          }
        />
      )}

      {mode.kind === 'questionnaire' && (
        <QuestionnaireView
          onComplete={(summary) =>
            setMode({
              kind: 'chat',
              title: 'Custom agent',
              seed: summary,
              from: 'questionnaire',
            })
          }
        />
      )}

      {mode.kind === 'chat' && <ChatView title={mode.title} seed={mode.seed} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  onBack,
  showSkip,
}: {
  onBack: (() => void) | null;
  showSkip: boolean;
}) {
  return (
    <header className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card shrink-0">
      <div className="w-6 h-6 rounded-md bg-primary-solid text-white flex items-center justify-center font-mono text-[11px] font-semibold">
        A
      </div>
      <span className="text-[13px] font-semibold text-foreground tracking-tight">
        Amodal Studio
      </span>
      <div className="ml-auto flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
        )}
        {showSkip && <SkipOnboardingButton />}
      </div>
    </header>
  );
}

function SkipOnboardingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skip = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/init-repo', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing API error
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `init-repo returned ${String(res.status)}`);
      }
      // useRepoState reads /api/repo-state on mount; reload swaps the page
      // for the workspace home now that amodal.json exists.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip onboarding');
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      <button
        type="button"
        onClick={() => { void skip(); }}
        disabled={busy}
        className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {busy ? 'Skipping…' : 'Skip onboarding →'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Picker view — tabs + cards + custom textarea + questionnaire link
// ---------------------------------------------------------------------------

function PickerView({
  onPick,
  onDescribe,
  onQuestionnaire,
}: {
  onPick: (agent: CatalogAgent) => void;
  onDescribe: (description: string) => void;
  onQuestionnaire: () => void;
}) {
  const { agentId = 'local' } = useParams<{ agentId: string }>();
  const { agents, loading, error } = useTemplateCatalog();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>(POPULAR_TAB);
  const [pickerInput, setPickerInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea as the user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, 120))}px`;
  }, [pickerInput]);

  const tabs = useMemo(() => {
    const seen = new Set<string>(TAB_ORDER);
    const extras: string[] = [];
    for (const a of agents) {
      if (!seen.has(a.category)) {
        seen.add(a.category);
        extras.push(a.category);
      }
    }
    return [...TAB_ORDER, ...extras];
  }, [agents]);

  const visibleAgents = useMemo(() => {
    const subset =
      activeTab === POPULAR_TAB
        ? agents.filter((a) => a.featured)
        : agents.filter((a) => a.category === activeTab);
    return subset.slice(0, PICKER_LIMIT);
  }, [agents, activeTab]);

  const send = () => {
    const trimmed = pickerInput.trim();
    if (trimmed === '') return;
    onDescribe(trimmed);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-8">
        {/* Templates */}
        <section className="flex flex-col gap-4">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight text-center">
            Start with an agent
          </h1>

          <PillTabs tabs={tabs} active={activeTab} onSelect={setActiveTab} />

          <CardGrid agents={visibleAgents} loading={loading} error={error} onPick={onPick} />

          {agents.length > 0 && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => { void navigate(`/agents/${agentId}/browse`); }}
                className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Browse all agents →
              </button>
            </div>
          )}
        </section>

        <div
          className="h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgb(120 120 120 / 0.3) 50%, transparent 100%)',
          }}
        />

        {/* Custom path */}
        <section className="flex flex-col gap-3 pb-8">
          <h2 className="text-[17px] font-semibold text-foreground tracking-tight">
            Or build your own
          </h2>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTION_CHIPS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPickerInput(p)}
                className="text-[12px] text-muted-foreground bg-card border border-border rounded-lg px-3 py-1.5 hover:bg-muted hover:text-foreground transition-colors"
              >
                {p}
              </button>
            ))}
          </div>

          <div
            className="rounded-2xl p-[1px]"
            style={{
              background:
                'linear-gradient(135deg, rgb(168 181 160) 0%, rgb(138 154 181) 50%, rgb(176 160 192) 100%)',
            }}
          >
            <div className="bg-card rounded-[15px] p-3 flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={pickerInput}
                onChange={(e) => setPickerInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Tell me what you do..."
                rows={2}
                className="w-full resize-none bg-transparent text-[13.5px] leading-[1.55] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={send}
                  disabled={pickerInput.trim() === ''}
                  className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-primary-solid text-white text-[12.5px] font-semibold disabled:opacity-40 disabled:cursor-default transition-opacity"
                >
                  Build
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="text-center mt-2">
            <button
              type="button"
              onClick={onQuestionnaire}
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground underline underline-offset-2 decoration-muted-foreground/40 transition-colors"
            >
              Need help coming up with ideas?
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PillTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: string[];
  active: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <div className="flex justify-center gap-0.5 flex-wrap">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tab)}
          className={cn(
            'text-[12.5px] rounded-lg px-3.5 py-1.5 transition-all',
            active === tab
              ? 'bg-card border border-border text-foreground font-semibold shadow-sm'
              : 'border border-transparent text-muted-foreground hover:text-foreground font-medium',
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function CardGrid({
  agents,
  loading,
  error,
  onPick,
}: {
  agents: CatalogAgent[];
  loading: boolean;
  error: string | null;
  onPick: (agent: CatalogAgent) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center border border-dashed border-border rounded-lg">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading agents…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-lg">
        Couldn&apos;t load agents. {error}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center border border-dashed border-border rounded-lg">
        Nothing here yet. Try another category, or describe what you need below.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {agents.map((a) => (
        <PickerCard key={a.slug} card={a.card} category={a.category} onClick={() => onPick(a)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view — description, preview, connections, skills, CTA
// ---------------------------------------------------------------------------

const PLACEHOLDER_DETAIL: CatalogAgentDetail = {
  description: 'Detail metadata for this template is on its way.',
  preview: [],
  connections: { required: [], optional: [] },
  skills: [],
  setup: { q: 'What tools do you use for this today?', choices: ['Other'] },
};

function DetailView({ agent, onSetup }: { agent: CatalogAgent; onSetup: () => void }) {
  const detail = agent.detail ?? PLACEHOLDER_DETAIL;
  const usesLabel = formatUsesLabel(agent.card.uses);
  const tintClass = categoryTint(agent.category);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight leading-tight">
              {agent.card.title}
            </h1>
            <p className="text-[13.5px] text-muted-foreground mt-1">
              {detail.description}
            </p>
          </div>
          {usesLabel && (
            <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 mt-1">
              {usesLabel}
            </span>
          )}
        </div>

        {/* Example output */}
        {detail.preview.length > 0 && (
          <div className={cn('rounded-xl p-4', tintClass)}>
            <div className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Example output
            </div>
            <div className="flex flex-col gap-3">
              {detail.preview.map((m, i) => (
                <div key={i}>
                  <div className="font-mono text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-widest mb-1">
                    {m.role === 'agent' ? 'Agent' : 'You'}
                  </div>
                  <div className="text-[13px] leading-[1.55] text-foreground whitespace-pre-line break-words">
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connections */}
        {(detail.connections.required.length > 0 || detail.connections.optional.length > 0) && (
          <div>
            <h3 className="text-[14px] font-semibold text-foreground mb-3">Connections</h3>

            {detail.connections.required.length > 0 && (
              <div className="mb-3">
                <div className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                  Required
                </div>
                <div className="flex flex-col gap-1.5">
                  {detail.connections.required.map((c) => (
                    <ConnectionRow key={c.name} name={c.name} desc={c.desc} required />
                  ))}
                </div>
              </div>
            )}

            {detail.connections.optional.length > 0 && (
              <div>
                <div className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                  Optional
                </div>
                <div className="flex flex-col gap-1.5">
                  {detail.connections.optional.map((c) => (
                    <ConnectionRow key={c.name} name={c.name} desc={c.desc} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Skills */}
        {detail.skills.length > 0 && (
          <div>
            <h3 className="text-[14px] font-semibold text-foreground mb-3">What it can do</h3>
            <div className="flex flex-col gap-2">
              {detail.skills.map((s) => (
                <div key={s.name} className="flex items-baseline gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 self-center" />
                  <div className="text-[13px]">
                    <span className="font-semibold text-foreground">{s.name}</span>
                    <span className="text-muted-foreground"> — {s.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={onSetup}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary-solid text-white text-[14px] font-semibold hover:bg-primary-solid/90 transition-colors"
          >
            Set this up
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="text-[12px] text-muted-foreground text-center">
            Takes about 2 minutes. You can change anything later.
          </p>
        </div>
      </div>
    </div>
  );
}

function ConnectionRow({
  name,
  desc,
  required,
}: {
  name: string;
  desc: string;
  required?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border',
        required ? 'bg-card border-border' : 'bg-muted/30 border-border/60',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            required ? 'bg-foreground' : 'bg-muted-foreground/50',
          )}
        />
        <span
          className={cn(
            'text-[13px] font-medium truncate',
            required ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {name}
        </span>
      </div>
      <span className="text-[12px] text-muted-foreground truncate">{desc}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questionnaire view — 3-step wizard that compiles to a chat seed
// ---------------------------------------------------------------------------

function QuestionnaireView({ onComplete }: { onComplete: (seed: string) => void }) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [pains, setPains] = useState<string[]>([]);
  const [tools, setTools] = useState('');
  const toolsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 2) toolsRef.current?.focus();
  }, [step]);

  const effectiveRole = role === '_custom' ? customRole : role;
  const togglePain = (p: string) =>
    setPains((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const finish = () => {
    const parts: string[] = [];
    if (effectiveRole.trim() !== '') parts.push(`I'm a ${effectiveRole.trim()}`);
    if (pains.length > 0) {
      parts.push(`Most of my time goes to: ${pains.join(', ').toLowerCase()}`);
    }
    if (tools.trim() !== '') parts.push(`Tools I use: ${tools.trim()}`);
    onComplete(`${parts.join('. ')}.`);
  };

  const steps: Array<{
    question: string;
    sub: string;
    canAdvance: boolean;
    content: React.ReactNode;
  }> = [
    {
      question: 'What do you do?',
      sub: 'Pick the closest match or type your own.',
      canAdvance: effectiveRole.trim() !== '',
      content: (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <Chip
                key={r}
                label={r}
                active={role === r}
                onClick={() => {
                  setRole(r);
                  setCustomRole('');
                }}
              />
            ))}
          </div>
          <input
            type="text"
            value={role === '_custom' ? customRole : ''}
            onChange={(e) => {
              setRole('_custom');
              setCustomRole(e.target.value);
            }}
            onFocus={() => setRole('_custom')}
            placeholder="Something else..."
            className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-foreground/30 transition-colors"
          />
        </div>
      ),
    },
    {
      question: 'What takes up most of your time?',
      sub: 'Pick all that apply.',
      canAdvance: pains.length > 0,
      content: (
        <div className="flex flex-wrap gap-1.5">
          {PAINS.map((p) => (
            <Chip key={p} label={p} active={pains.includes(p)} onClick={() => togglePain(p)} />
          ))}
        </div>
      ),
    },
    {
      question: 'Any tools you already use?',
      sub: 'Optional — helps us connect the right things.',
      canAdvance: true,
      content: (
        <input
          ref={toolsRef}
          type="text"
          value={tools}
          onChange={(e) => setTools(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish();
          }}
          placeholder="Google Calendar, QuickBooks, Slack, texting..."
          className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-foreground/30 transition-colors"
        />
      ),
    },
  ];

  const cur = steps[step];
  if (!cur) return null;
  const isLast = step === steps.length - 1;

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-10 overflow-y-auto">
      <div className="max-w-lg w-full">
        <div
          className="rounded-2xl p-[1px]"
          style={{
            background:
              'linear-gradient(135deg, rgb(168 181 160) 0%, rgb(138 154 181) 50%, rgb(176 160 192) 100%)',
          }}
        >
          <div className="bg-card rounded-[15px] p-5">
            {/* Progress */}
            <div className="flex gap-1 mb-6">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex-1 h-[3px] rounded-sm transition-colors',
                    i <= step ? 'bg-foreground' : 'bg-muted',
                  )}
                />
              ))}
            </div>

            {/* Step body */}
            <div key={step}>
              <h3 className="text-[18px] font-semibold text-foreground mb-1">{cur.question}</h3>
              <p className="text-[13px] text-muted-foreground mb-4">{cur.sub}</p>
              {cur.content}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-5">
              <button
                type="button"
                onClick={() => step > 0 && setStep(step - 1)}
                disabled={step === 0}
                className={cn(
                  'text-[12.5px] transition-colors',
                  step > 0
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-transparent cursor-default',
                )}
              >
                ← Back
              </button>
              <div className="flex gap-2">
                {!isLast && step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="px-4 py-2 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Skip
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isLast ? finish() : setStep(step + 1))}
                  disabled={!cur.canAdvance}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-[12.5px] font-semibold transition-colors',
                    cur.canAdvance
                      ? 'bg-primary-solid text-white hover:bg-primary-solid/90'
                      : 'bg-muted text-muted-foreground/60 cursor-default',
                  )}
                >
                  {isLast ? 'Build my agent' : 'Next'}
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-[13px] font-medium rounded-lg px-3.5 py-2 border transition-colors',
        active
          ? 'bg-primary-solid text-white border-primary-solid'
          : 'bg-muted/40 text-foreground border-border hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat view — full-screen AdminChat seeded with the user's intent
// ---------------------------------------------------------------------------

function ChatView({ seed }: { title: string; seed: string }) {
  // Send the seed message once on mount via the AdminChat's CustomEvent
  // listener. Small timeout lets AdminChat finish wiring its event handler
  // before we dispatch — without it the very first chat-view mount can
  // miss the event.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('admin-chat-send', { detail: seed }));
    }, SEED_DELAY_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [seed]);

  return (
    <div className="flex-1 min-h-0">
      <AdminChat compact={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUsesLabel(uses: number | undefined): string | null {
  if (uses === undefined || uses === 0) return null;
  if (uses < 1000) return `${String(uses)} uses`;
  return `${(uses / 1000).toFixed(1).replace(/\.0$/, '')}k uses`;
}

const CATEGORY_TINTS: Record<string, string> = {
  Marketing: 'bg-emerald-50 dark:bg-emerald-950/40',
  Support: 'bg-blue-50 dark:bg-blue-950/40',
  Sales: 'bg-amber-50 dark:bg-amber-950/40',
  Ops: 'bg-violet-50 dark:bg-violet-950/40',
};

function categoryTint(category: string | undefined): string {
  return (category && CATEGORY_TINTS[category]) || 'bg-muted/40';
}

