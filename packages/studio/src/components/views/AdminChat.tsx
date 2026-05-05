/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Chat UI lives in @amodalai/react/widget — feature changes go there, not here.
// This file is intentionally thin.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChatWidget } from '@amodalai/react/widget';
import { streamSSE } from '@amodalai/react';
import type { SSEEvent, ChatMessage, ChatAction, InlineBlockRendererRegistry } from '@amodalai/react';
import type { ConnectionsStatusMap, SetupWarning } from '@amodalai/types';
import { useTheme } from '../ThemeProvider';
import { StudioConnectionPanel } from '../StudioConnectionPanel';
import {
  ConfirmCompletionModal,
  CompletionWarningsModal,
} from './CompletionModals';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'amodal-admin-chat-v2';

interface PersistedChat {
  sessionId: string | null;
  messages: ChatMessage[];
}

function loadPersistedChat(): PersistedChat {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessionId: null, messages: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { sessionId: null, messages: [] };

    const data = parsed as { sessionId?: unknown; messages?: unknown };
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];
    // Validate each element has the minimum ChatMessage shape (type + id)
    const validMessages = rawMessages.filter(
      (m: unknown): m is ChatMessage =>
        typeof m === 'object' && m !== null && 'type' in m && 'id' in m,
    );
    return {
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
      messages: validMessages,
    };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function persistChat(chat: PersistedChat): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chat));
  } catch (err: unknown) {
    // eslint-disable-next-line no-console -- browser SPA, no structured logger; quota exceeded or private browsing
    console.warn('[AdminChat] persist_chat_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Reconciliation — Phase H.10
// ---------------------------------------------------------------------------

/**
 * Walk every `connection_panel` block in the loaded message list,
 * fetch real env-var status from `/api/connections-status`, and
 * dispatch one `PANEL_UPDATE` per panel. Real-state `configured`
 * wins over a stale chat-history `state` field — that's the whole
 * reason for this pass: the user could have configured a connection
 * out-of-band via the per-connection page or by editing `.env`
 * directly between sessions.
 *
 * Rule (per the H.10 spec):
 *   - real-state `configured: true` → `state: 'success'` (overrides Skip)
 *   - else `userSkipped: true` → `state: 'skipped'`
 *   - else → `state: 'idle'`
 *
 * Errors fetching the status map are swallowed — better to keep the
 * stale cached state than to crash the chat. The next mount retries.
 */
async function runReconciliation(
  messages: ChatMessage[],
  dispatch: (action: ChatAction) => void,
): Promise<void> {
  const panels = collectConnectionPanels(messages);
  if (panels.length === 0) return;

  let map: ConnectionsStatusMap;
  try {
    const res = await fetch('/api/connections-status', {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
    map = (await res.json()) as ConnectionsStatusMap;
  } catch (err: unknown) {
    // eslint-disable-next-line no-console -- browser SPA, no structured logger
    console.warn('[AdminChat] connections_status_fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const panel of panels) {
    const status = map[panel.packageName];
    let nextState: 'idle' | 'success' | 'skipped' | 'error' = 'idle';
    if (status?.configured) {
      nextState = 'success';
    } else if (panel.userSkipped) {
      nextState = 'skipped';
    }
    if (nextState === panel.state) continue;
    dispatch({
      type: 'PANEL_UPDATE',
      panelId: panel.panelId,
      patch: { state: nextState },
    });
  }
}

interface ConnectionPanelRef {
  panelId: string;
  packageName: string;
  state: 'idle' | 'success' | 'skipped' | 'error';
  userSkipped: boolean;
}

function collectConnectionPanels(messages: ChatMessage[]): ConnectionPanelRef[] {
  const out: ConnectionPanelRef[] = [];
  for (const msg of messages) {
    if (msg.type !== 'assistant_text') continue;
    for (const block of msg.contentBlocks) {
      if (block.type !== 'connection_panel') continue;
      out.push({
        panelId: block.panelId,
        packageName: block.packageName,
        state: block.state,
        userSkipped: block.userSkipped === true,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Finish-setup state machine — Phase E.6
// ---------------------------------------------------------------------------

type FinishState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'confirm' }
  | { kind: 'warnings'; warnings: SetupWarning[] }
  | { kind: 'committing'; force: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string; force: boolean };

interface CheckCompletionResponse {
  ok?: boolean;
  ready?: boolean;
  alreadyComplete?: boolean;
  warnings?: SetupWarning[];
  reason?: string;
  message?: string;
}

interface CommitResponse {
  ok?: boolean;
  alreadyComplete?: boolean;
  warnings?: SetupWarning[];
  reason?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface AdminChatProps {
  compact?: boolean;
  /**
   * Auto-send this message on mount (exactly once). Used by the create
   * flow to seed the admin agent with the user's setup intent without
   * the user having to type or click Send.
   */
  initialMessage?: string;
  /**
   * Phase E.11 — fired when the agent's `cancel_setup` tool emits a
   * `setup_cancelled` SSE event. The parent (CreateFlowPage) flips
   * back to picker mode in response.
   */
  onSetupCancelled?: (reason: string | undefined) => void;
  /**
   * Phase E.6 — render the "Finish setup" button. Defaults to true
   * for the create-flow chat-mode mount; pass `false` for embeddings
   * (e.g. the post-setup floating admin panel) where finish-mode is
   * meaningless.
   */
  showFinishButton?: boolean;
  /**
   * Phase F.9 — the user is resuming a setup that already has
   * progress (the start response returned `seeded: false` and the
   * row had at least one completed/skipped slot, currentStep > 0,
   * or a plan attached). Renders a muted banner above the chat and
   * shifts the input placeholder to "Reply or ask a question…" so
   * the field nudges the user back into the conversation rather
   * than feeling like a blank prompt.
   */
  resuming?: boolean;
}

export function AdminChat({
  compact = true,
  initialMessage,
  onSetupCancelled,
  showFinishButton = true,
  resuming = false,
}: AdminChatProps) {
  const { dark } = useTheme();
  // Snapshot the persisted chat once on first render. Used to seed
  // the widget on mount (LOAD_HISTORY) so a page reload restores both
  // the session id (so subsequent turns hit the same agent_sessions
  // row) AND the in-memory message list (so the user sees their
  // existing chat instead of a blank pane).
  const persistedRef = useRef(loadPersistedChat());
  const sessionIdRef = useRef<string | null>(persistedRef.current.sessionId);
  const onSetupCancelledRef = useRef(onSetupCancelled);
  onSetupCancelledRef.current = onSetupCancelled;

  // streamFn intercepts setup_cancelled SSE events before they reach
  // the widget reducer (which doesn't render anything for them — the
  // signal is for the parent CreateFlowPage to flip back to picker).
  const streamFn = useCallback(
    (text: string, signal: AbortSignal): AsyncIterable<SSEEvent> => {
      const body: Record<string, unknown> = {
        message: text,
        app_id: 'admin',
        // session_type: 'admin' is what the runtime keys off to register
        // the admin onboarding tool surface (install_package,
        // search_packages, write_skill). Without this the agent sees
        // tool_not_found on install_package even though it's defined.
        session_type: 'admin',
      };
      if (sessionIdRef.current) body['session_id'] = sessionIdRef.current;
      const upstream = streamSSE('/api/studio/admin-chat/stream', body, { signal });
      return (async function* () {
        for await (const event of upstream) {
          if (event.type === 'setup_cancelled') {
            // event is narrowed to SSESetupCancelledEvent here — `reason`
            // is `string | undefined` natively, no cast needed.
            onSetupCancelledRef.current?.(event.reason);
          }
          if (event.type === 'setup_completed') {
            // Setup was committed (amodal.json on disk + completedAt
            // set). Clear local chat state and reload to '/' — IndexPage
            // will probe repo-state, see both signals settled, and
            // route to OverviewPage. Polling-based transition would
            // catch up within ~2s anyway, but the SSE signal closes
            // the gap so the user doesn't sit on the chat after
            // "Your <Agent> is ready" wondering if anything happened.
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              // private mode / quota — non-fatal
            }
            // Defer the reload one tick so the chat reducer can finish
            // ingesting any in-flight events and the user sees the
            // agent's final reply land before the page flips.
            setTimeout(() => { window.location.href = '/'; }, 600);
          }
          yield event;
        }
      })();
    },
    [],
  );

  // Phase H.10 — capture the latest message list + a one-shot
  // reconciliation gate. When the first non-empty message list lands
  // (history rehydrated), kick off the connections-status fetch and
  // dispatch PANEL_UPDATE per connection_panel block. Subsequent
  // message changes don't re-fire the reconciliation — the build
  // plan calls this out explicitly to avoid clobbering live SSE
  // updates mid-session.
  const messagesRef = useRef<ChatMessage[]>([]);
  const dispatchRef = useRef<((action: ChatAction) => void) | null>(null);
  const reconciledRef = useRef(false);

  const handleStateChange = useCallback(
    (state: { sessionId: string | null; messages: ChatMessage[] }) => {
      sessionIdRef.current = state.sessionId ?? sessionIdRef.current;
      messagesRef.current = state.messages;
      persistChat({ sessionId: sessionIdRef.current, messages: state.messages });

      // Once messages and dispatch are both available, trigger the
      // reconciliation pass exactly once. Subsequent state changes
      // (live SSE deltas, user turns) are no-ops.
      if (
        !reconciledRef.current &&
        dispatchRef.current &&
        state.messages.length > 0
      ) {
        reconciledRef.current = true;
        const dispatch = dispatchRef.current;
        const messages = state.messages;
        void runReconciliation(messages, dispatch);
      }
    },
    [],
  );

  const handleWidgetReady = useCallback(
    (handle: { dispatch: (action: ChatAction) => void }) => {
      dispatchRef.current = handle.dispatch;

      // Rehydrate the chat from localStorage. Fires once on widget
      // ready — the widget starts with empty state, and we seed both
      // the messages and the sessionId here so a page reload restores
      // exactly what the user saw before the refresh. The widget's
      // own onStateChange will keep persisting after this.
      const persisted = persistedRef.current;
      if (persisted.sessionId && persisted.messages.length > 0) {
        handle.dispatch({
          type: 'LOAD_HISTORY',
          sessionId: persisted.sessionId,
          messages: persisted.messages,
        });
        // Seed messagesRef so the H.10 reconciliation pass below has
        // the rehydrated list to walk for connection panels.
        messagesRef.current = persisted.messages;
      }

      // If the message list is non-empty (just rehydrated, or arrived
      // via stream before the widget exposed dispatch), kick off
      // reconciliation against /api/connections-status.
      if (
        !reconciledRef.current &&
        messagesRef.current.length > 0
      ) {
        reconciledRef.current = true;
        void runReconciliation(messagesRef.current, handle.dispatch);
      }
    },
    [],
  );

  // Phase H.2 / H.3 — Studio supplies the renderer for
  // `connection_panel` blocks. The widget is auth-agnostic; the
  // panel + modal are Studio-owned because they fetch
  // `/api/connections-status`, summon Studio's modal stack, and
  // inspect env vars.
  const inlineBlockRenderers = useMemo<InlineBlockRendererRegistry>(
    () => ({ connection_panel: StudioConnectionPanel }),
    [],
  );

  // Phase F.8: the full-screen chat-mode AdminChat (compact=false) is
  // the create-flow setup chat — the input belongs to a continuing
  // back-and-forth, so the placeholder reads "Reply or ask a
  // question…". The compact post-setup admin panel reads "Ask
  // anything…" — the user is in workspace mode at that point, not
  // in a guided flow.
  const placeholder = compact
    ? 'Ask anything...'
    : 'Reply or ask a question...';

  return (
    <div className="h-full relative flex flex-col">
      {resuming && (
        <div className="px-4 py-2 text-[11.5px] text-muted-foreground italic border-b border-border bg-muted/30">
          Resuming where you left off.
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <ChatWidget
          serverUrl=""
          user={{ id: 'admin' }}
          position="inline"
          defaultOpen
          showInput
          streamFn={streamFn}
          onStateChange={handleStateChange}
          onReady={handleWidgetReady}
          inlineBlockRenderers={inlineBlockRenderers}
          {...(initialMessage && persistedRef.current.messages.length === 0
            ? { initialMessage }
            : {})}
          theme={{
            mode: dark ? 'dark' : 'light',
            // Onboarding chat (full-screen, compact=false) gets a
            // user-friendly "Onboarding Agent" label. The post-setup
            // floating admin panel (compact=true) keeps its existing
            // "Admin Agent" label since by then the user is past
            // setup and the admin terminology fits better.
            headerText: compact ? 'Admin Agent' : 'Onboarding Agent',
            emptyStateText: 'Ask me to add connections, write skills, create automations, or validate your setup.',
            placeholder,
          }}
        />
        {showFinishButton && <FinishSetupButton />}
        {showFinishButton && <RestartSetupButton />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FinishSetupButton — Phase E.6
// ---------------------------------------------------------------------------

/**
 * Always-visible button + completion modals. The button never gates
 * on a "are we close enough" heuristic — the validation gate is on
 * click via /check-completion, and the warning modal is what protects
 * against premature commits.
 */
function FinishSetupButton() {
  const [state, setState] = useState<FinishState>({ kind: 'idle' });

  const handleClick = useCallback(async (): Promise<void> => {
    setState({ kind: 'checking' });
    try {
      const res = await fetch('/api/studio/admin-chat/check-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
      const data = (await res.json()) as CheckCompletionResponse;

      if (data.alreadyComplete === true) {
        setState({ kind: 'done' });
        return;
      }
      if (data.ready === true) {
        setState({ kind: 'confirm' });
        return;
      }
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      setState({ kind: 'warnings', warnings });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check completion';
      setState({ kind: 'error', message, force: false });
    }
  }, []);

  const commit = useCallback(async (force: boolean): Promise<void> => {
    setState({ kind: 'committing', force });
    try {
      const res = await fetch('/api/studio/admin-chat/commit-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
        signal: AbortSignal.timeout(15_000),
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
      const data = (await res.json()) as CommitResponse;
      if (data.ok === true) {
        setState({ kind: 'done' });
        // IndexPage's polling picks up the new amodal.json and swaps
        // the page to OverviewPage within ~2s; nothing else to do
        // here. The modal stays mounted but the page transitions out
        // from under it.
        return;
      }
      if (data.reason === 'not_ready' && Array.isArray(data.warnings)) {
        // The user clicked Finish before any warnings existed
        // server-side, then state changed underneath. Fall back to
        // the warnings modal.
        setState({ kind: 'warnings', warnings: data.warnings });
        return;
      }
      setState({ kind: 'error', message: data.message ?? 'Commit failed', force });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to commit setup';
      setState({ kind: 'error', message, force });
    }
  }, []);

  const close = useCallback((): void => {
    setState({ kind: 'idle' });
  }, []);

  const showConfirm =
    state.kind === 'confirm' ||
    (state.kind === 'committing' && !state.force) ||
    (state.kind === 'error' && !state.force);
  const showWarnings =
    state.kind === 'warnings' ||
    (state.kind === 'committing' && state.force) ||
    (state.kind === 'error' && state.force);

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={state.kind === 'checking' || state.kind === 'committing'}
        className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-md text-[11.5px] font-medium border border-border bg-card text-foreground shadow-sm hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.kind === 'checking' ? 'Checking…' : 'Finish setup'}
      </button>
      <ConfirmCompletionModal
        open={showConfirm}
        busy={state.kind === 'committing'}
        error={state.kind === 'error' ? state.message : null}
        onCancel={close}
        onConfirm={() => void commit(false)}
      />
      <CompletionWarningsModal
        open={showWarnings}
        busy={state.kind === 'committing'}
        warnings={state.kind === 'warnings' ? state.warnings : []}
        error={state.kind === 'error' ? state.message : null}
        onBackToChat={close}
        onFinishAnyway={() => void commit(true)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// RestartSetupButton
// ---------------------------------------------------------------------------

const STORAGE_KEY_FOR_RESTART = STORAGE_KEY;

/**
 * Wipe everything install_template put in motion + reset the chat.
 * Two-step modal so the user can't trip on it: button opens a confirm
 * dialog with a checkbox to also wipe vendored files; default keeps
 * files (DB-only reset). On confirm, POSTs /restart with the wipe
 * flag, clears chat localStorage, drops the `?chat=` URL param via
 * a full reload to /, and Studio's IndexPage routes back to the
 * picker.
 */
function RestartSetupButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wipeFiles, setWipeFiles] = useState(true);

  const handleConfirm = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/studio/admin-chat/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wipeFiles }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        const data = (await res.json().catch(() => ({}))) as {error?: {message?: string}};
        throw new Error(data.error?.message ?? `Restart failed: ${String(res.status)}`);
      }
      // Clear local chat state.
      try {
        localStorage.removeItem(STORAGE_KEY_FOR_RESTART);
      } catch {
        // private mode / quota — non-fatal
      }
      // Full reload back to root. IndexPage's repo-state probe will
      // see no amodal.json + no setup_state row → CreateFlowPage in
      // pick mode. Using window.location instead of react-router so
      // we re-mount everything fresh (admin agent's session id, the
      // ChatWidget reducer state, etc.).
      window.location.href = '/';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to restart setup');
      setBusy(false);
    }
  }, [wipeFiles]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="absolute top-3 right-32 z-10 px-3 py-1.5 rounded-md text-[11.5px] font-medium border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted/40 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Restart setup
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Restart setup"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl p-5">
            <h2 className="text-[14px] font-semibold text-foreground tracking-tight mb-2">
              Restart setup?
            </h2>
            <p className="text-[13px] text-foreground leading-relaxed mb-3">
              This deletes the current setup state and the chat history. You&apos;ll go back to the template picker.
            </p>
            <label className="flex items-start gap-2 text-[12.5px] text-foreground mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={wipeFiles}
                onChange={(e) => setWipeFiles(e.target.checked)}
                className="mt-0.5"
                disabled={busy}
              />
              <span>
                Also wipe template files from the repo (<code className="font-mono text-[11.5px]">amodal.json</code>, <code className="font-mono text-[11.5px]">node_modules</code>, vendored skills/knowledge/automations/etc.)
              </span>
            </label>
            {error && (
              <p className="mb-2 text-[12px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[12px] border border-border text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[12px] bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Restarting…' : 'Restart'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
