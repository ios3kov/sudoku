"use client";

import { useLayoutEffect, type RefObject } from "react";

const MAX_COMPOSER_HEIGHT = 128;

export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    function resize() {
      if (!node) return;
      node.style.height = "auto";
      const nextHeight = Math.min(node.scrollHeight, MAX_COMPOSER_HEIGHT);
      node.style.height = nextHeight + "px";
      node.style.overflowY = node.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
    }
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("sudoku:text-size-changed", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("sudoku:text-size-changed", resize);
    };
  }, [ref, value]);
}
