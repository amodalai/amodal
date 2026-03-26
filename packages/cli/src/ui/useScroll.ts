/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useState, useCallback, useEffect, useRef} from 'react';

export interface ScrollState {
  scrollTop: number;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  scrollBy: (delta: number) => void;
  scrollToTop: () => void;
  setContentHeight: (height: number) => void;
  setViewportHeight: (height: number) => void;
}

/**
 * Manages scroll state for a virtual viewport.
 * Auto-scrolls to bottom when new content arrives while already at bottom.
 */
export function useScroll(autoScrollOnContent: boolean): ScrollState {
  const [scrollTop, setScrollTop] = useState(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const isAtBottomRef = useRef(true);

  const getMaxScroll = useCallback(
    () => Math.max(0, contentHeightRef.current - viewportHeightRef.current),
    [],
  );

  const clamp = useCallback(
    (value: number) => Math.max(0, Math.min(value, getMaxScroll())),
    [getMaxScroll],
  );

  const scrollToBottom = useCallback(() => {
    const max = getMaxScroll();
    setScrollTop(max);
    isAtBottomRef.current = true;
  }, [getMaxScroll]);

  const scrollToTop = useCallback(() => {
    setScrollTop(0);
    isAtBottomRef.current = contentHeightRef.current <= viewportHeightRef.current;
  }, []);

  const scrollBy = useCallback(
    (delta: number) => {
      setScrollTop((prev) => {
        const next = clamp(prev + delta);
        isAtBottomRef.current = next >= getMaxScroll();
        return next;
      });
    },
    [clamp, getMaxScroll],
  );

  const setContentHeight = useCallback(
    (height: number) => {
      contentHeightRef.current = height;
      // Auto-scroll if we were at bottom
      if (autoScrollOnContent && isAtBottomRef.current) {
        const max = Math.max(0, height - viewportHeightRef.current);
        setScrollTop(max);
      }
    },
    [autoScrollOnContent],
  );

  const setViewportHeight = useCallback((height: number) => {
    viewportHeightRef.current = height;
  }, []);

  // Keep isAtBottom in sync
  const isAtBottom = scrollTop >= getMaxScroll() || contentHeightRef.current <= viewportHeightRef.current;
  isAtBottomRef.current = isAtBottom;

  // Auto-scroll to bottom on initial render
  useEffect(() => {
    if (autoScrollOnContent && isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [autoScrollOnContent, scrollToBottom]);

  return {
    scrollTop,
    isAtBottom,
    scrollToBottom,
    scrollBy,
    scrollToTop,
    setContentHeight,
    setViewportHeight,
  };
}
