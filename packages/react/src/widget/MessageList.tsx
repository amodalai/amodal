/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import type {
  ChatMessage,
  AssistantTextMessage,
  ConfirmationInfo,
  InlineBlockRendererRegistry,
  ChatAction,
  ContentBlock,
} from '../types';
import type { InteractionEvent } from '../events/types';
import { ToolCallCard } from './ToolCallCard';
import { KBProposalCard } from './KBProposalCard';

/** Convert bare URLs to markdown links so react-markdown renders them as clickable. */
function autolinkUrls(text: string): string {
  return text.replace(
    /(?<!\[.*?\]\()(?<!\()(https?:\/\/[^\s<)]+)/g,
    '[$1]($1)',
  );
}

/** Tools that render their own UI via inline SSE events. Hide the ToolCallCard chrome for these. */
const UI_TOOLS = new Set(['collect_secret', 'start_oauth', 'ask_choice', 'show_preview', 'clone_template', 'onboarding_step']);
import { SkillPill } from './SkillPill';
import { StreamingIndicator } from './StreamingIndicator';
import { AskUserCard } from './AskUserCard';
import { AskChoiceCard } from './AskChoiceCard';
import { AgentCardInlinePreview } from './AgentCardInline';
import { PlanSummaryCard } from './PlanSummaryCard';
import { ProposalCard } from './ProposalCard';
import { WidgetRenderer } from './widgets/WidgetRenderer';
import type { WidgetRegistry } from './widgets/WidgetRenderer';
import { ConfirmCard } from '../components/ConfirmCard';
import { ReviewCard } from '../components/ReviewCard';

const FEEDBACK_PATH = '/api/feedback' as const;

function FeedbackButtons({ messageId, sessionId, query, response }: {
  messageId: string;
  sessionId?: string;
  query: string;
  response: string;
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');

  const submit = useCallback((r: 'up' | 'down', c?: string) => {
    setRating(r);
    setShowComment(false);
    fetch(FEEDBACK_PATH, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sessionId: sessionId ?? '', messageId, rating: r, comment: c, query, response}),
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console -- browser widget, no logger available
      console.warn('[MessageList] feedback_post_failed', { messageId, error: err instanceof Error ? err.message : String(err) });
    });
  }, [sessionId, messageId, query, response]);

  const clear = useCallback(() => {
    setRating(null);
    setShowComment(false);
    setComment('');
  }, []);

  return (
    <div className="pcw-feedback">
      <button
        className={`pcw-feedback__btn ${rating === 'up' ? 'pcw-feedback__btn--active' : ''}`}
        onClick={() => rating === 'up' ? clear() : submit('up')}
        title={rating === 'up' ? 'Undo' : 'Good response'}
      ><svg width="14" height="14" viewBox="0 0 24 24" fill={rating === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg></button>
      <button
        className={`pcw-feedback__btn ${rating === 'down' ? 'pcw-feedback__btn--active' : ''}`}
        onClick={() => {
          if (rating === 'down') clear();
          else if (showComment) submit('down', comment || undefined);
          else setShowComment(true);
        }}
        title={rating === 'down' ? 'Undo' : 'Bad response'}
      ><svg width="14" height="14" viewBox="0 0 24 24" fill={rating === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg></button>
      {showComment && (
        <div className="pcw-feedback__comment">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit('down', comment || undefined); }}
            placeholder="What went wrong? (optional)"
            className="pcw-feedback__input"
            autoFocus
          />
          <button className="pcw-feedback__submit" onClick={() => submit('down', comment || undefined)}>Submit</button>
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamStartTime?: number;
  sendMessage?: (text: string) => void;
  customWidgets?: WidgetRegistry;
  onInteraction?: (event: InteractionEvent) => void;
  onAskUserSubmit?: (askId: string, answers: Record<string, string>) => void;
  onAskChoiceSubmit?: (askId: string, values: string[], message: string) => void;
  onProposalSubmit?: (proposalId: string, answer: 'confirm' | 'adjust', message: string) => void;
  onConfirmationRespond?: (correlationId: string, approved: boolean) => void;
  emptyStateText?: string;
  sessionId?: string;
  showFeedback?: boolean;
  verboseTools?: boolean;
  /** H.2 — Studio-supplied renderers for non-native block types. */
  inlineBlockRenderers?: InlineBlockRendererRegistry;
  /** Reducer dispatch handle, threaded down so registered renderers can dispatch (e.g. PANEL_UPDATE). */
  dispatch?: React.Dispatch<ChatAction>;
}

/**
 * H.2 fallback path. When MessageList's switch hits a block type it
 * doesn't render natively, look it up in the consumer-supplied
 * registry. Renderers receive the typed block plus a `dispatch`
 * (for `PANEL_UPDATE` and similar) and `postUserMessage` (to inject
 * "Skip Slack for now" / "Configured Slack" replies). Returns a
 * dev-only placeholder when no renderer is registered so missed
 * registrations are visible rather than silent.
 */
function renderInlineBlock(
  block: ContentBlock,
  index: number,
  registry: InlineBlockRendererRegistry | undefined,
  dispatch: React.Dispatch<ChatAction> | undefined,
  postUserMessage: ((text: string) => void) | undefined,
): React.ReactNode {
  const key = `${block.type}-${String(index)}`;
  if (!registry || !dispatch) {
    return <InlineBlockPlaceholder key={key} type={block.type} />;
  }
  const Renderer = registry[block.type];
  if (!Renderer) {
    return <InlineBlockPlaceholder key={key} type={block.type} />;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- registry maps each block type to a renderer for that exact type via Extract<>
  const Typed = Renderer as React.ComponentType<{block: ContentBlock; dispatch: React.Dispatch<ChatAction>; postUserMessage: (text: string) => void}>;
  return (
    <Typed
      key={key}
      block={block}
      dispatch={dispatch}
      postUserMessage={postUserMessage ?? (() => undefined)}
    />
  );
}

function InlineBlockPlaceholder({ type }: { type: string }) {
  return (
    <div className="pcw-bubble__placeholder" role="status">
      [{type} — no renderer registered]
    </div>
  );
}

function ConfirmationCard({ confirmation, onApprove, onDeny }: {
  confirmation: ConfirmationInfo;
  onApprove: () => void;
  onDeny: () => void;
}) {
  if (confirmation.escalated || (confirmation.params && Object.keys(confirmation.params).length > 0)) {
    return <ReviewCard confirmation={confirmation} onApprove={onApprove} onDeny={onDeny} />;
  }
  return <ConfirmCard confirmation={confirmation} onApprove={onApprove} onDeny={onDeny} />;
}

function AssistantBubble({
  message,
  sendMessage,
  customWidgets,
  onInteraction,
  onAskUserSubmit,
  onAskChoiceSubmit,
  onProposalSubmit,
  onConfirmationRespond,
  verboseTools,
  inlineBlockRenderers,
  dispatch,
}: {
  message: AssistantTextMessage;
  sendMessage?: (text: string) => void;
  customWidgets?: WidgetRegistry;
  onInteraction?: (event: InteractionEvent) => void;
  onAskUserSubmit?: (askId: string, answers: Record<string, string>) => void;
  onAskChoiceSubmit?: (askId: string, values: string[], message: string) => void;
  onProposalSubmit?: (proposalId: string, answer: 'confirm' | 'adjust', message: string) => void;
  onConfirmationRespond?: (correlationId: string, approved: boolean) => void;
  verboseTools?: boolean;
  inlineBlockRenderers?: InlineBlockRendererRegistry;
  dispatch?: React.Dispatch<ChatAction>;
}) {
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasExtras =
    message.toolCalls.length > 0 ||
    message.skillActivations.length > 0 ||
    message.kbProposals.length > 0;

  // Don't render an empty bubble while waiting for content
  const hasAnyContent = hasContentBlocks || message.text.length > 0 || hasExtras;
  if (!hasAnyContent) return null;

  // If we have content blocks, render them in order for proper interleaving
  if (hasContentBlocks) {
    // Tool calls are already in contentBlocks — only render KB proposals separately
    const hasKBProposals = message.kbProposals.length > 0;
    return (
      <div className="pcw-bubble pcw-bubble--assistant">
        {message.skillActivations.map((skill) => (
          <SkillPill key={skill} skill={skill} />
        ))}
        {message.contentBlocks.map((block, i) => {
          switch (block.type) {
            case 'text':
              return block.text.length > 0 ? (
                <div key={`text-${String(i)}`} className="pcw-bubble__text pcw-markdown">
                  <Markdown>{autolinkUrls(block.text)}</Markdown>
                </div>
              ) : null;
            case 'widget':
              return (
                <WidgetRenderer
                  key={`widget-${String(i)}`}
                  widgetType={block.widgetType}
                  data={block.data}
                  sendMessage={sendMessage ?? (() => {})}
                  customWidgets={customWidgets}
                  onInteraction={onInteraction}
                />
              );
            case 'tool_calls': {
              const visibleCalls = block.calls.filter(
                (tc) => !UI_TOOLS.has(tc.toolName) && (verboseTools || !tc.internal),
              );
              if (visibleCalls.length === 0) return null;
              return (
                <div key={`tools-${String(i)}`} className="pcw-bubble__extras">
                  {visibleCalls.map((tc) => (
                    <ToolCallCard key={tc.toolId} toolCall={tc} verbose={verboseTools} />
                  ))}
                </div>
              );
            }
            case 'ask_user':
              return (
                <AskUserCard
                  key={`ask-${block.askId}`}
                  block={block}
                  onSubmit={onAskUserSubmit ?? (() => {})}
                />
              );
            case 'ask_choice':
              return (
                <AskChoiceCard
                  key={`choice-${block.askId}`}
                  block={block}
                  onSubmit={onAskChoiceSubmit ?? (() => {})}
                />
              );
            case 'show_preview':
              return (
                <AgentCardInlinePreview
                  key={`preview-${String(i)}`}
                  card={block.card}
                />
              );
            case 'plan_summary':
              return (
                <PlanSummaryCard
                  key={`plan-${String(i)}`}
                  block={block}
                />
              );
            case 'proposal':
              return (
                <ProposalCard
                  key={`proposal-${block.proposalId}`}
                  block={block}
                  onSubmit={onProposalSubmit ?? (() => {})}
                />
              );
            case 'confirmation': {
              const conf = block.confirmation;
              return (
                <ConfirmationCard
                  key={`conf-${String(i)}`}
                  confirmation={conf}
                  onApprove={() => { if (conf.correlationId && onConfirmationRespond) onConfirmationRespond(conf.correlationId, true); }}
                  onDeny={() => { if (conf.correlationId && onConfirmationRespond) onConfirmationRespond(conf.correlationId, false); }}
                />
              );
            }
            case 'connection_panel':
              // H.2 — connection_panel is the first non-native block;
              // Studio supplies the renderer via inlineBlockRenderers.
              // Falls through to the registry / placeholder below.
              return renderInlineBlock(block, i, inlineBlockRenderers, dispatch, sendMessage);
            default:
              return renderInlineBlock(block, i, inlineBlockRenderers, dispatch, sendMessage);
          }
        })}
        {hasKBProposals && (
          <div className="pcw-bubble__extras">
            {message.kbProposals.map((proposal, idx) => (
              <KBProposalCard key={`${proposal.title}-${String(idx)}`} proposal={proposal} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Fallback: legacy rendering without content blocks
  return (
    <div className="pcw-bubble pcw-bubble--assistant">
      {message.skillActivations.map((skill) => (
        <SkillPill key={skill} skill={skill} />
      ))}
      {message.text.length > 0 && (
        <div className="pcw-bubble__text pcw-markdown">
          <Markdown>{autolinkUrls(message.text)}</Markdown>
        </div>
      )}
      {hasExtras && (
        <div className="pcw-bubble__extras">
          {message.toolCalls
            .filter((tc) => verboseTools || !tc.internal)
            .map((tc) => (
              <ToolCallCard key={tc.toolId} toolCall={tc} verbose={verboseTools} />
            ))}
          {message.kbProposals.map((proposal, idx) => (
            <KBProposalCard key={`${proposal.title}-${String(idx)}`} proposal={proposal} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages, isStreaming, streamStartTime, sendMessage, customWidgets, onInteraction, onAskUserSubmit, onAskChoiceSubmit, onProposalSubmit, onConfirmationRespond, emptyStateText, sessionId, showFeedback = false, verboseTools = false, inlineBlockRenderers, dispatch }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [fadingElapsed, setFadingElapsed] = useState<number | null>(null);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      setFadingElapsed(null);
    } else if (wasStreamingRef.current && streamStartTime) {
      const elapsed = Math.floor((Date.now() - streamStartTime) / 1000);
      wasStreamingRef.current = false;
      if (elapsed >= 1) {
        setFadingElapsed(elapsed);
        const timer = setTimeout(() => setFadingElapsed(null), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isStreaming, streamStartTime]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 100;
      shouldAutoScroll.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="pcw-messages--empty">
        <p>{emptyStateText ?? 'Send a message to start a conversation.'}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="pcw-messages">
      {messages.map((msg) => {
        switch (msg.type) {
          case 'user':
            return (
              <div key={msg.id} className="pcw-bubble pcw-bubble--user">
                {msg.images && msg.images.length > 0 && (
                  <div className="pcw-bubble__images">
                    {msg.images.map((src, i) => (
                      <img key={i} src={src} alt="User attachment" className="pcw-bubble__image" />
                    ))}
                  </div>
                )}
                <p className="pcw-bubble__text">{msg.text}</p>
              </div>
            );
          case 'assistant_text': {
            const idx = messages.indexOf(msg);
            const prevUser = messages.slice(0, idx).reverse().find((m) => m.type === 'user');
            const qText = prevUser && 'text' in prevUser ? String(prevUser.text) : '';
            const rText = msg.contentBlocks
              ?.filter((b): b is {type: 'text'; text: string} => b.type === 'text')
              .map((b) => b.text)
              .join('') ?? msg.text;
            return (
              <div key={msg.id}>
                <AssistantBubble
                  message={msg}
                  sendMessage={sendMessage}
                  customWidgets={customWidgets}
                  onInteraction={onInteraction}
                  onAskUserSubmit={onAskUserSubmit}
                  onAskChoiceSubmit={onAskChoiceSubmit}
                  onProposalSubmit={onProposalSubmit}
                  onConfirmationRespond={onConfirmationRespond}
                  verboseTools={verboseTools}
                  inlineBlockRenderers={inlineBlockRenderers}
                  dispatch={dispatch}
                />
                {showFeedback && !isStreaming && (
                  <FeedbackButtons messageId={msg.id} sessionId={sessionId} query={qText} response={rText} />
                )}
              </div>
            );
          }
          case 'error':
            return (
              <div key={msg.id} className="pcw-error">
                {msg.message}
              </div>
            );
          default:
            return null;
        }
      })}
      {isStreaming && <StreamingIndicator startTime={streamStartTime} />}
      {fadingElapsed !== null && (
        <div className="pcw-elapsed pcw-elapsed--fading">{String(fadingElapsed)}s</div>
      )}
    </div>
  );
}
