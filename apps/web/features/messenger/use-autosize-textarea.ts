"use client";

import { RefObject, useLayoutEffect } from "react";

const MAX_COMPOSER_HEIGHT = 128;

export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    node.style.height = "auto";
    const nextHeight = Math.min(node.scrollHeight, MAX_COMPOSER_HEIGHT);
    node.style.height = nextHeight + "px";
    node.style.overflowY = node.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, [ref, value]);
}
