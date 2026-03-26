/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from '../theme.js';

/**
 * Simple regex-based syntax highlighting.
 * Highlights keywords, strings, comments, numbers for common languages.
 */
function highlightLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Pattern: single-line comments, strings, numbers, keywords
  const pattern =
    /(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+\.?\d*\b)|\b(const|let|var|function|class|import|export|from|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|new|typeof|instanceof|async|await|yield|default|interface|type|enum|extends|implements|public|private|protected|static|readonly|abstract|override|declare|namespace|module|require|in|of|as|is|void|null|undefined|true|false|this|super)\b/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`t${lastIndex}`} color={theme.text.primary}>
          {line.slice(lastIndex, match.index)}
        </Text>,
      );
    }

    if (match[1]) {
      // Comment
      parts.push(
        <Text key={`c${match.index}`} color={theme.code.comment}>
          {match[0]}
        </Text>,
      );
    } else if (match[2]) {
      // String
      parts.push(
        <Text key={`s${match.index}`} color={theme.code.string}>
          {match[0]}
        </Text>,
      );
    } else if (match[3]) {
      // Number
      parts.push(
        <Text key={`n${match.index}`} color={theme.code.number}>
          {match[0]}
        </Text>,
      );
    } else if (match[4]) {
      // Keyword
      parts.push(
        <Text key={`k${match.index}`} color={theme.code.keyword}>
          {match[0]}
        </Text>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < line.length) {
    parts.push(
      <Text key={`e${lastIndex}`} color={theme.text.primary}>
        {line.slice(lastIndex)}
      </Text>,
    );
  }

  if (parts.length === 0) {
    return <Text color={theme.text.primary}>{line}</Text>;
  }

  return <Text>{parts}</Text>;
}

interface CodeBlockProps {
  code: string;
  language?: string;
  width?: number;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({code, width}) => {
  const lines = code.split('\n');
  // Remove trailing empty line from code blocks
  if (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
    lines.pop();
  }

  const gutterWidth = String(lines.length).length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.ui.muted}
      paddingLeft={1}
      paddingRight={1}
      width={width ? Math.min(width - 2, 100) : undefined}
    >
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={theme.ui.dim}>
            {String(i + 1).padStart(gutterWidth, ' ')}
            {'  '}
          </Text>
          {highlightLine(line)}
        </Box>
      ))}
    </Box>
  );
};
