/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared prose-styled Markdown renderer using react-markdown.
 * Use this for rich content display (session history, knowledge bodies, etc.)
 * where full markdown fidelity is needed. For chat message rendering inside
 * ChatWidget, use the widget's built-in FormattedText instead.
 */

import Markdown from 'react-markdown';

interface FormattedMarkdownProps {
  children: string;
  /** Additional CSS classes appended to the prose container. */
  className?: string;
}

/**
 * Renders markdown content with Tailwind Typography (prose) styling
 * that works in both light and dark modes.
 */
export function FormattedMarkdown({ children, className }: FormattedMarkdownProps) {
  return (
    <div className={`prose dark:prose-invert max-w-none ${className ?? ''}`}>
      <Markdown>{children}</Markdown>
    </div>
  );
}
