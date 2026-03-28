/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Lightweight markdown-to-HTML renderer for chat text.
 * Handles: headers, bold, italic, inline code, code blocks, bullet lists, links, line breaks.
 * No external dependencies.
 */

/** Escape HTML entities to prevent XSS. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert inline markdown (bold, italic, code, links) to HTML. */
function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="pcw-md-code">$1</code>');
  // Bold + italic: ***text*** or ___text___
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_ (but not mid-word underscores)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return html;
}

/** Convert a markdown string to HTML. */
function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        output.push(`<pre class="pcw-md-codeblock"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        if (inList) { output.push('</ul>'); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) { output.push('</ul>'); inList = false; }
      continue;
    }

    // Headers
    const headerMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headerMatch) {
      if (inList) { output.push('</ul>'); inList = false; }
      const level = headerMatch[1].length;
      output.push(`<h${String(level)} class="pcw-md-h${String(level)}">${inlineMarkdown(headerMatch[2])}</h${String(level)}>`);
      continue;
    }

    // Bullet list item: - text or * text or number. text
    const listMatch = /^(\s*)[-*]\s+(.+)$/.exec(line) ?? /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (listMatch) {
      if (!inList) { output.push('<ul class="pcw-md-list">'); inList = true; }
      output.push(`<li>${inlineMarkdown(listMatch[2])}</li>`);
      continue;
    }

    // Regular paragraph
    if (inList) { output.push('</ul>'); inList = false; }
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  // Close any open blocks
  if (inCodeBlock) {
    output.push(`<pre class="pcw-md-codeblock"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  if (inList) {
    output.push('</ul>');
  }

  return output.join('\n');
}

interface FormattedTextProps {
  text: string;
  className?: string;
}

export function FormattedText({ text, className }: FormattedTextProps) {
  const html = markdownToHtml(text);
  return (
    <div
      className={`pcw-formatted-text${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
