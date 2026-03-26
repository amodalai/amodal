/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { AmodalChat } from '@amodalai/react';

/**
 * Chat home screen — full-width chat interface.
 */
export function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <AmodalChat />
      </div>
    </div>
  );
}
