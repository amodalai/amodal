/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';
import type { ConfirmationInfo } from '../types';
import { useAmodalChat } from '../hooks/useAmodalChat';
import { ConfirmCard } from './ConfirmCard';
import { ReviewCard } from './ReviewCard';

export interface AmodalActionProps {
  /** The prompt to send when the action is triggered. */
  prompt: string;
  /** Label for the trigger button. */
  label?: string;
  /** Additional context sent with the chat message. */
  context?: Record<string, unknown>;
  /** Called when the action completes. */
  onComplete?: (text: string) => void;
  /** Called on error. */
  onError?: (error: string) => void;
}

/**
 * One-shot action: triggers a chat stream with a prompt, shows confirmation inline.
 */
export function AmodalAction({ prompt, label, context, onComplete, onError }: AmodalActionProps) {
  const [triggered, setTriggered] = useState(false);

  const { messages, send, isStreaming, respondToConfirmation } = useAmodalChat({
    context,
    onStreamEnd: () => {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.type === 'assistant_text') {
        onComplete?.(lastMsg.text);
      } else if (lastMsg && lastMsg.type === 'error') {
        onError?.(lastMsg.message);
      }
    },
  });

  const trigger = useCallback(() => {
    if (triggered || isStreaming) return;
    setTriggered(true);
    send(prompt);
  }, [triggered, isStreaming, send, prompt]);

  const lastAssistant = [...messages].reverse().find((m) => m.type === 'assistant_text');
  const pendingConfirmations: ConfirmationInfo[] =
    lastAssistant && lastAssistant.type === 'assistant_text'
      ? lastAssistant.confirmations.filter((c) => c.status === 'pending')
      : [];

  const renderConfirmation = (confirmation: ConfirmationInfo, index: number) => {
    const handleApprove = () => {
      if (confirmation.correlationId) {
        respondToConfirmation(confirmation.correlationId, true);
      }
    };
    const handleDeny = () => {
      if (confirmation.correlationId) {
        respondToConfirmation(confirmation.correlationId, false);
      }
    };

    if (confirmation.escalated || (confirmation.params && Object.keys(confirmation.params).length > 0)) {
      return (
        <ReviewCard
          key={confirmation.correlationId ?? String(index)}
          confirmation={confirmation}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      );
    }

    return (
      <ConfirmCard
        key={confirmation.correlationId ?? String(index)}
        confirmation={confirmation}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />
    );
  };

  if (!triggered) {
    return (
      <button
        className="amodal-action__trigger"
        onClick={trigger}
        data-testid="action-trigger"
      >
        {label ?? 'Run'}
      </button>
    );
  }

  return (
    <div className="amodal-action" data-testid="action-container">
      {isStreaming && (
        <div className="amodal-action__loading" data-testid="action-loading">
          Processing...
        </div>
      )}
      {lastAssistant && lastAssistant.type === 'assistant_text' && lastAssistant.text && (
        <div className="amodal-action__result" data-testid="action-result">
          {lastAssistant.text}
        </div>
      )}
      {pendingConfirmations.map(renderConfirmation)}
    </div>
  );
}
