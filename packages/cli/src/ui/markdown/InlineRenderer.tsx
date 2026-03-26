/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Text} from 'ink';
import {theme} from '../theme.js';

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
}

/**
 * Parse inline markdown into styled segments.
 * Handles: **bold**, *italic*, ~~strikethrough~~, `code`, [text](url)
 */
function parseInline(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Order matters — bold+italic first, then bold, then italic
  const pattern =
    /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(~~(.+?)~~)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      segments.push({text: input.slice(lastIndex, match.index)});
    }

    if (match[2]) {
      // ***bold italic***
      segments.push({text: match[2], bold: true, italic: true});
    } else if (match[4]) {
      // **bold**
      segments.push({text: match[4], bold: true});
    } else if (match[6]) {
      // *italic*
      segments.push({text: match[6], italic: true});
    } else if (match[8]) {
      // _italic_
      segments.push({text: match[8], italic: true});
    } else if (match[10]) {
      // ~~strikethrough~~
      segments.push({text: match[10], strikethrough: true});
    } else if (match[12]) {
      // `code`
      segments.push({text: match[12], code: true});
    } else if (match[14] && match[15]) {
      // [text](url)
      segments.push({text: match[14], link: match[15]});
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < input.length) {
    segments.push({text: input.slice(lastIndex)});
  }

  if (segments.length === 0) {
    segments.push({text: input});
  }

  return segments;
}

interface InlineRendererProps {
  text: string;
}

export const InlineRenderer: React.FC<InlineRendererProps> = ({text}) => {
  const segments = parseInline(text);

  return (
    <Text>
      {segments.map((seg, i) => {
        if (seg.code) {
          return (
            <Text key={i} color={theme.code.keyword}>
              {seg.text}
            </Text>
          );
        }
        if (seg.link) {
          return (
            <Text key={i} color={theme.text.link}>
              {seg.text}
              <Text color={theme.ui.dim}> ({seg.link})</Text>
            </Text>
          );
        }
        return (
          <Text
            key={i}
            bold={seg.bold}
            italic={seg.italic}
            strikethrough={seg.strikethrough}
          >
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
};
