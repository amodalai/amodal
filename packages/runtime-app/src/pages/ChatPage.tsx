/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Send, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import Markdown from 'react-markdown';
import { useAmodalChat } from '@amodalai/react';
import type { ToolCallInfo, ContentBlock, ConfirmationInfo } from '@amodalai/react';

function ToolCallBadge({ call }: { call: ToolCallInfo }) {
  const isRunning = call.status === 'running';
  const isError = call.status === 'error';
  return (
    <div className="flex items-center gap-2 px-3 py-2 my-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-xs font-mono">
      {isRunning ? (
        <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin shrink-0" />
      ) : isError ? (
        <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      )}
      <span className="text-indigo-300 font-semibold">{call.toolName}</span>
      {call.duration_ms != null && (
        <span className="text-zinc-500 ml-auto">{String(call.duration_ms)}ms</span>
      )}
    </div>
  );
}

function ConfirmationCard({ confirmation, onApprove, onDeny }: {
  confirmation: ConfirmationInfo;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const resolved = confirmation.status === 'approved' || confirmation.status === 'denied';
  return (
    <div className="my-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-300 mb-1">
        <Wrench className="h-4 w-4" />
        <span className="uppercase text-[11px] font-bold bg-indigo-500 text-white px-1.5 py-0.5 rounded">
          {confirmation.method}
        </span>
        <span className="text-zinc-300">{confirmation.endpoint}</span>
      </div>
      {confirmation.reason && (
        <p className="text-xs text-zinc-400 mb-2">{confirmation.reason}</p>
      )}
      {!resolved ? (
        <div className="flex gap-2">
          <button onClick={onApprove} className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
            Approve
          </button>
          <button onClick={onDeny} className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 text-zinc-300 border border-zinc-600 hover:bg-zinc-600 transition-colors">
            Deny
          </button>
        </div>
      ) : (
        <span className={`text-xs font-semibold ${confirmation.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
          {confirmation.status === 'approved' ? 'Approved' : 'Denied'}
        </span>
      )}
    </div>
  );
}

function MessageContent({ blocks, respondToConfirmation }: {
  blocks: ContentBlock[];
  respondToConfirmation: (id: string, approved: boolean) => void;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <div key={`t-${String(i)}`} className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-200 prose-p:text-zinc-300 prose-strong:text-zinc-200 prose-code:text-indigo-300 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-zinc-800/80 prose-pre:border prose-pre:border-zinc-700/50 prose-a:text-indigo-400 prose-li:text-zinc-300">
                <Markdown>{block.text}</Markdown>
              </div>
            );
          case 'tool_calls':
            return (
              <div key={`tc-${String(i)}`}>
                {block.calls.map((call) => <ToolCallBadge key={call.toolId} call={call} />)}
              </div>
            );
          case 'confirmation': {
            const conf = block.confirmation;
            return (
              <ConfirmationCard
                key={`cf-${String(i)}`}
                confirmation={conf}
                onApprove={() => { if (conf.correlationId) respondToConfirmation(conf.correlationId, true); }}
                onDeny={() => { if (conf.correlationId) respondToConfirmation(conf.correlationId, false); }}
              />
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

export function ChatPage() {
  const { messages, send, isStreaming, activeToolCalls, respondToConfirmation } = useAmodalChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isStreaming) return;
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      send(trimmed);
    },
    [input, isStreaming, send],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed && !isStreaming) {
          setInput('');
          if (inputRef.current) inputRef.current.style.height = 'auto';
          send(trimmed);
        }
      }
    },
    [input, isStreaming, send],
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!hasMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" className="mb-5 opacity-30">
              <defs><clipPath id="empty-sq"><rect x="2" y="10" width="17" height="17" rx="3" /></clipPath></defs>
              <rect x="2" y="10" width="17" height="17" rx="3" fill="#1E40AF" />
              <circle cx="22" cy="11" r="10" fill="#60A5FA" fillOpacity="0.85" />
              <circle cx="22" cy="11" r="10" fill="#3B82F6" clipPath="url(#empty-sq)" />
            </svg>
            <h2 className="text-lg font-medium text-zinc-400 mb-1">What can I help with?</h2>
            <p className="text-sm text-zinc-600 max-w-sm">Ask me anything. I can search, analyze, and connect to your tools.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.map((msg) => {
              switch (msg.type) {
                case 'user':
                  return (
                    <div key={msg.id} className="mb-6 flex justify-end">
                      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-indigo-600 text-white text-[14px] leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  );
                case 'assistant_text':
                  return (
                    <div key={msg.id} className="mb-6">
                      <div className="text-[14px] text-zinc-200">
                        <MessageContent blocks={msg.contentBlocks} respondToConfirmation={respondToConfirmation} />
                      </div>
                    </div>
                  );
                case 'error':
                  return (
                    <div key={msg.id} className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                      {msg.message}
                    </div>
                  );
                default:
                  return null;
              }
            })}
            {isStreaming && activeToolCalls.length === 0 && (
              <div className="flex items-center gap-2 text-zinc-500 text-sm mb-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800/80 bg-[#0f0f17] px-4 py-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            disabled={isStreaming}
            rows={1}
            className="w-full resize-none rounded-xl bg-zinc-800/80 border border-zinc-700/60 px-4 py-3 pr-12 text-[14px] text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-colors disabled:opacity-50 overflow-y-auto"
            style={{ minHeight: '48px', maxHeight: '160px' }}
          />
          <button
            type="submit"
            disabled={isStreaming || input.trim().length === 0}
            className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-500 transition-colors disabled:opacity-20 disabled:hover:bg-indigo-600"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
