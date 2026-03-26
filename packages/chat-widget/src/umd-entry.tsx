/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ChatWidget } from './components/ChatWidget';
import type { WidgetConfig } from './types';
import { ChatClient } from './client/ChatClient';

interface PlatformChatInstance {
  root: Root;
  container: HTMLElement;
}

let instance: PlatformChatInstance | null = null;

/**
 * Initialize the chat widget in a non-React environment.
 * Call PlatformChat.init(config) or PlatformChat.mount(config) to render the widget.
 */
function init(config: WidgetConfig & { container?: string }): void {
  if (instance) {
    destroy();
  }

  let container: HTMLElement;
  if (config.container) {
    const el = document.querySelector(config.container);
    if (!el) {
      throw new Error(`Container element not found: ${config.container}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DOM element cast
    container = el as HTMLElement;
  } else {
    container = document.createElement('div');
    container.id = 'platform-chat-widget';
    document.body.appendChild(container);
  }

  const root = createRoot(container);
  root.render(<ChatWidget {...config} />);
  instance = { root, container };
}

/**
 * Destroy the chat widget and clean up.
 */
function destroy(): void {
  if (!instance) return;
  instance.root.unmount();
  if (instance.container.id === 'platform-chat-widget' && instance.container.parentNode) {
    instance.container.parentNode.removeChild(instance.container);
  }
  instance = null;
}

export const PlatformChat = { init, mount: init, destroy, ChatClient };
export default PlatformChat;
