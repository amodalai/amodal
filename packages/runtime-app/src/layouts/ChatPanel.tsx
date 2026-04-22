/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { ChatWidget } from '@amodalai/react/widget';
import { useAuth } from '@/hooks/useAuth';
import { X } from 'lucide-react';

const RUNTIME_URL = window.location.origin;

export interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Slide-in chat panel for non-chat pages.
 */
export function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const { getToken } = useAuth();

  if (!isOpen) return null;

  return (
    <div className="w-[380px] border-l border-border bg-card flex flex-col shrink-0 animate-slide-in-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-medium text-foreground">Chat</span>
        <button
          onClick={onClose}
          className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatWidget
          serverUrl={RUNTIME_URL}
          user={{ id: 'anonymous' }}
          getToken={getToken}
          position="inline"
        />
      </div>
    </div>
  );
}
