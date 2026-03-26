/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react';
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

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage?: (text: string) => void;
  customWidgets?: WidgetRegistry;
  onInteraction?: (event: InteractionEvent) => void;
  onAskUserSubmit?: (askId: string, answers: Record<string, string>) => void;
  emptyStateText?: string;
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

export function MessageList({ messages, isStreaming, sendMessage, customWidgets, onInteraction, onAskUserSubmit, emptyStateText }: MessageListProps) {
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
                <p className="pcw-bubble__text">{msg.text}</p>
              </div>
            );
          case 'assistant_text':
            return (
              <AssistantBubble
                key={msg.id}
                message={msg}
                sendMessage={sendMessage}
                customWidgets={customWidgets}
                onInteraction={onInteraction}
                onAskUserSubmit={onAskUserSubmit}
              />
            );
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
