/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {UserMessage} from './UserMessage.js';
import {AssistantMessage} from './AssistantMessage.js';
import type {ChatMessage} from './types.js';

interface MessageListProps {
  messages: ChatMessage[];
  width?: number;
}

/**
 * Pure render component — maps messages to UserMessage/AssistantMessage.
 * No longer uses <Static>; parent controls scrolling.
 */
export const MessageList: React.FC<MessageListProps> = ({messages, width}) => (
  <>
    {messages.map((message) =>
      message.role === 'user' ? (
        <UserMessage key={message.id} text={message.text} />
      ) : (
        <AssistantMessage key={message.id} message={message} width={width} />
      ),
    )}
  </>
);
