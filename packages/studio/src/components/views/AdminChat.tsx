/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useRef, useEffect } from 'react';
import { useAdminChat } from '@/hooks/useAdminChat';
import { ToolCallCard } from '@/components/ToolCallCard';
import type { ChatToolCall } from '@/hooks/useAdminChat';
import type { ToolCallInfo } from '@/components/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adapt a ChatToolCall (from the SSE stream) to a ToolCallInfo (for ToolCallCard).
 */
function toToolCallInfo(tc: ChatToolCall, index: number): ToolCallInfo {
  return {
    toolId: `chat-tool-${String(index)}`,
    toolName: tc.name,
    parameters: tc.params,
    status: tc.status === 'error' ? 'error' : tc.status === 'running' ? 'running' : 'success',
    result: tc.result,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminChat() {
  const { messages, isStreaming, send, stop, reset } = useAdminChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput('');
    void send(text);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground">Admin Chat</h1>
        <button
          type="button"
          onClick={reset}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-muted-foreground text-sm pt-12">
            Send a message to the admin agent to get started.
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-primary-solid text-white'
                  : 'bg-card border border-border text-foreground'
              }`}
            >
              {msg.content && (
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              )}
              {msg.toolCalls?.map((tc, j) => (
                <ToolCallCard key={j} call={toToolCallInfo(tc, j)} />
              ))}
            </div>
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (messages[messages.length - 1]?.toolCalls?.length ?? 0) === 0 && (
          <div className="text-sm text-muted-foreground animate-pulse">Thinking...</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="pt-3 border-t border-border flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the admin agent..."
          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            className="px-4 py-2 text-sm bg-card border border-border rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 text-sm bg-primary-solid text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
