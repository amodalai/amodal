/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage, AssistantTextMessage } from '../types';
import type { InteractionEvent } from '../events/types';
import { ToolCallCard } from './ToolCallCard';
import { KBProposalCard } from './KBProposalCard';
import { SkillPill } from './SkillPill';
import { FormattedText } from './FormattedText';
import { StreamingIndicator } from './StreamingIndicator';
import { AskUserCard } from './AskUserCard';
import { WidgetRenderer } from './widgets/WidgetRenderer';
import type { WidgetRegistry } from './widgets/WidgetRenderer';

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
    fetch('/api/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sessionId: sessionId ?? '', messageId, rating: r, comment: c, query, response}),
    }).catch(() => {});
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
      >👍</button>
      <button
        className={`pcw-feedback__btn ${rating === 'down' ? 'pcw-feedback__btn--active' : ''}`}
        onClick={() => {
          if (rating === 'down') clear();
          else if (showComment) submit('down', comment || undefined);
          else setShowComment(true);
        }}
        title={rating === 'down' ? 'Undo' : 'Bad response'}
      >👎</button>
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
  sendMessage?: (text: string) => void;
  customWidgets?: WidgetRegistry;
  onInteraction?: (event: InteractionEvent) => void;
  onAskUserSubmit?: (askId: string, answers: Record<string, string>) => void;
  emptyStateText?: string;
  sessionId?: string;
}

function AssistantBubble({
  message,
  sendMessage,
  customWidgets,
  onInteraction,
  onAskUserSubmit,
}: {
  message: AssistantTextMessage;
  sendMessage?: (text: string) => void;
  customWidgets?: WidgetRegistry;
  onInteraction?: (event: InteractionEvent) => void;
  onAskUserSubmit?: (askId: string, answers: Record<string, string>) => void;
}) {
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasExtras =
    message.toolCalls.length > 0 ||
    message.skillActivations.length > 0 ||
    message.kbProposals.length > 0;

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
          // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- TODO: handle all cases
          switch (block.type) {
            case 'text':
              return block.text.length > 0 ? (
                <FormattedText key={`text-${String(i)}`} text={block.text} className="pcw-bubble__text" />
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
            case 'tool_calls':
              return (
                <div key={`tools-${String(i)}`} className="pcw-bubble__extras">
                  {block.calls.map((tc) => (
                    <ToolCallCard key={tc.toolId} toolCall={tc} />
                  ))}
                </div>
              );
            case 'ask_user':
              return (
                <AskUserCard
                  key={`ask-${block.askId}`}
                  block={block}
                  onSubmit={onAskUserSubmit ?? (() => {})}
                />
              );
            default:
              return null;
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
      {message.text.length > 0 && <FormattedText className="pcw-bubble__text" text={message.text} />}
      {hasExtras && (
        <div className="pcw-bubble__extras">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.toolId} toolCall={tc} />
          ))}
          {message.kbProposals.map((proposal, idx) => (
            <KBProposalCard key={`${proposal.title}-${String(idx)}`} proposal={proposal} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages, isStreaming, sendMessage, customWidgets, onInteraction, onAskUserSubmit, emptyStateText, sessionId }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

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
                />
                {!isStreaming && (
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
      {isStreaming && <StreamingIndicator />}
    </div>
  );
}
