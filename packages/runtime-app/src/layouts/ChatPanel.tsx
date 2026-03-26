/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { AmodalChat } from '@amodalai/react';
import { X } from 'lucide-react';

export interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Slide-in chat panel for non-chat pages.
 */
export function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="w-[380px] border-l border-gray-200 bg-white flex flex-col shrink-0 animate-slide-in-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-900">Chat</span>
        <button
          onClick={onClose}
          className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <AmodalChat />
      </div>
    </div>
  );
}
