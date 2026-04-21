/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { ChatWidget } from './widget/ChatWidget';
import type { ChatWidgetProps } from './widget/ChatWidget';

export type AmodalChatProps = Omit<ChatWidgetProps, 'position'> & {
  /** CSS class name for the root wrapper element. */
  className?: string;
};

/**
 * Full chat component — thin wrapper around ChatWidget with inline positioning.
 *
 * Use this for the simplest integration:
 *   import { AmodalChat } from '@amodalai/react';
 *
 * For more control (floating, history, custom widgets), use ChatWidget directly:
 *   import { ChatWidget } from '@amodalai/react/widget';
 */
export function AmodalChat({ className, ...props }: AmodalChatProps) {
  return (
    <div className={className} data-testid="amodal-chat">
      <ChatWidget position="inline" {...props} />
    </div>
  );
}
