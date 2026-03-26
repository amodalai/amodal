/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ConfirmationInfo, ToolCallInfo } from './types';
import { useAmodalChat } from './hooks/useAmodalChat';
import type { UseAmodalChatOptions } from './hooks/useAmodalChat';
import { ConfirmCard } from './components/ConfirmCard';
import { ReviewCard } from './components/ReviewCard';

export interface AmodalChatProps extends UseAmodalChatOptions {
  /** Placeholder text for the input bar. */
  placeholder?: string;
  /** Custom renderer for text content blocks. */
  renderText?: (text: string) => React.ReactNode;
  /** Custom renderer for tool call blocks. */
  renderToolCall?: (call: ToolCallInfo) => React.ReactNode;
  /** Custom renderer for confirmation blocks. */
  renderConfirmation?: (confirmation: ConfirmationInfo, onApprove: () => void, onDeny: () => void) => React.ReactNode;
  /** CSS class name for the root element. */
  className?: string;
}

/**
 * Full chat component — message list, input bar, renders confirmations inline.
 */
export function AmodalChat({
  placeholder = 'Type a message...',
  renderText,
  renderToolCall,
  renderConfirmation,
  className,
  ...hookOptions
}: AmodalChatProps) {
  const { messages, send, isStreaming, respondToConfirmation } = useAmodalChat(hookOptions);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed.length === 0 || isStreaming) return;
      setInput('');
      send(trimmed);
    },
    [input, isStreaming, send],
  );

  const rootClass = ['amodal-chat', className].filter(Boolean).join(' ');

  return (
    <div className={rootClass} data-testid="amodal-chat">
      <div className="amodal-chat__messages" data-testid="message-list">
        {messages.map((msg) => {
          switch (msg.type) {
            case 'user':
              return (
                <div key={msg.id} className="amodal-chat__message amodal-chat__message--user" data-testid="user-message">
                  {msg.text}
                </div>
              );
            case 'assistant_text':
              return (
                <div key={msg.id} className="amodal-chat__message amodal-chat__message--assistant" data-testid="assistant-message">
                  {msg.contentBlocks.map((block, i) => {
                    switch (block.type) {
                      case 'text':
                        return (
                          <div key={`text-${String(i)}`} className="amodal-chat__text">
                            {renderText ? renderText(block.text) : block.text}
                          </div>
                        );
                      case 'tool_calls':
                        return (
                          <div key={`tools-${String(i)}`} className="amodal-chat__tool-calls">
                            {block.calls.map((call) =>
                              renderToolCall ? (
                                <div key={call.toolId}>{renderToolCall(call)}</div>
                              ) : (
                                <div key={call.toolId} className="amodal-chat__tool-call" data-testid="tool-call">
                                  <span className="amodal-chat__tool-name">{call.toolName}</span>
                                  <span className="amodal-chat__tool-status">{call.status}</span>
                                </div>
                              ),
                            )}
                          </div>
                        );
                      case 'confirmation': {
                        const conf = block.confirmation;
                        const handleApprove = () => {
                          if (conf.correlationId) {
                            respondToConfirmation(conf.correlationId, true);
                          }
                        };
                        const handleDeny = () => {
                          if (conf.correlationId) {
                            respondToConfirmation(conf.correlationId, false);
                          }
                        };
                        if (renderConfirmation) {
                          return <div key={`conf-${String(i)}`}>{renderConfirmation(conf, handleApprove, handleDeny)}</div>;
                        }
                        if (conf.escalated || (conf.params && Object.keys(conf.params).length > 0)) {
                          return <ReviewCard key={`conf-${String(i)}`} confirmation={conf} onApprove={handleApprove} onDeny={handleDeny} />;
                        }
                        return <ConfirmCard key={`conf-${String(i)}`} confirmation={conf} onApprove={handleApprove} onDeny={handleDeny} />;
                      }
                      case 'widget':
                        return (
                          <div key={`widget-${String(i)}`} className="amodal-chat__widget" data-testid="widget">
                            {block.widgetType}
                          </div>
                        );
                      default:
                        return null;
                    }
                  })}
                </div>
              );
            case 'error':
              return (
                <div key={msg.id} className="amodal-chat__message amodal-chat__message--error" data-testid="error-message">
                  {msg.message}
                </div>
              );
            default:
              return null;
          }
        })}
        <div ref={messagesEndRef} />
      </div>
      <form className="amodal-chat__input-bar" onSubmit={handleSubmit} data-testid="input-bar">
        <input
          className="amodal-chat__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={isStreaming}
          data-testid="chat-input"
        />
        <button
          className="amodal-chat__send"
          type="submit"
          disabled={isStreaming || input.trim().length === 0}
          data-testid="send-button"
        >
          Send
        </button>
      </form>
    </div>
  );
}
