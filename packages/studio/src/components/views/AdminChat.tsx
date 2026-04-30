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
  const sessionIdRef = useRef<string | null>(loadPersistedChat().sessionId);
  const onSetupCancelledRef = useRef(onSetupCancelled);
  onSetupCancelledRef.current = onSetupCancelled;

  // streamFn intercepts setup_cancelled SSE events before they reach
  // the widget reducer (which doesn't render anything for them — the
  // signal is for the parent CreateFlowPage to flip back to picker).
  const streamFn = useCallback(
    (text: string, signal: AbortSignal): AsyncIterable<SSEEvent> => {
      const body: Record<string, unknown> = { message: text, app_id: 'admin' };
      if (sessionIdRef.current) body['session_id'] = sessionIdRef.current;
      const upstream = streamSSE('/api/studio/admin-chat/stream', body, { signal });
      return (async function* () {
        for await (const event of upstream) {
          if (event.type === 'setup_cancelled') {
             
            const reason = (event as { reason?: string }).reason;
            onSetupCancelledRef.current?.(reason);
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
      // If the message list landed before the widget exposed dispatch
      // (race against the rehydrate path), trigger reconciliation now.
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
          {...(initialMessage ? { initialMessage } : {})}
          theme={{
            mode: dark ? 'dark' : 'light',
            headerText: 'Admin Agent',
            emptyStateText: 'Ask me to add connections, write skills, create automations, or validate your setup.',
            placeholder,
          }}
        />
        {showFinishButton && <FinishSetupButton />}
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
