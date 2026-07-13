"use client";

import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import { isListMarkdownBlock, type MarkdownBlock } from "../model";
import { cn } from "../utils";


export function BlockDropIndicator({ active, listLevel }: { active: boolean; listLevel: number }) {
  const boundedListLevel = Math.max(0, Math.min(4, listLevel));

  return (
    <div
      aria-hidden="true"
      data-testid="markdown-drop-indicator"
      data-active={active ? "true" : "false"}
      data-list-level={boundedListLevel}
      className="pointer-events-none relative z-10 h-0"
    >
      <span
        data-testid="markdown-drop-indicator-line"
        style={{ left: `${28 + boundedListLevel * 28}px` }}
        className={cn(
          "bg-primary absolute top-[-1px] right-3 h-0.5 rounded-full opacity-0 shadow-sm transition-opacity",
          active && "opacity-100",
        )}
      />
    </div>
  );
}

export function markdownBlockEditorPrefix(block: MarkdownBlock) {
  if (!isListMarkdownBlock(block)) {
    return "";
  }

  return block.source.match(/^[ \t]*(?:[-*+]|\d+\.)\s+/)?.[0] ?? "";
}

export function BlockDragHandle({
  index,
  block,
  onPointerDown,
  onMove,
}: {
  index: number;
  block: MarkdownBlock;
  onPointerDown: (index: number, event: React.PointerEvent<HTMLButtonElement>) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const handleOffset = blockHandleOffset(block);

  return (
    <button
      type="button"
      data-testid="markdown-block-drag-handle"
      aria-label={`Move block ${index + 1}`}
      onPointerDown={(event) => onPointerDown(index, event)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onMove(index, index - 1);
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onMove(index, index + 1);
        }
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:text-foreground flex size-7 shrink-0 !cursor-grab items-center justify-center bg-transparent opacity-0 outline-none transition-colors focus-visible:opacity-100 active:!cursor-grabbing group-hover/block:opacity-100 group-focus-within/block:opacity-100",
      )}
      style={{ marginTop: handleOffset }}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  );
}

export function blockHandleOffset(block: MarkdownBlock) {
  if (isListMarkdownBlock(block)) {
    return 0;
  }

  if (block.kind === "thematic-break") {
    return 6.5;
  }

  if (block.kind === "code") {
    return 17;
  }

  if (block.kind === "empty") {
    return 6.65;
  }

  if (block.kind === "heading") {
    if (block.headingLevel === 1) {
      return 9;
    }
    if (block.headingLevel === 2) {
      return 6.5;
    }
    if (block.headingLevel === 3) {
      return 5.25;
    }
    return 4;
  }

  return 8;
}

export function reindexAfterMove(currentIndex: number | null, fromIndex: number, toIndex: number) {
  if (currentIndex === null || fromIndex === toIndex || toIndex < 0) {
    return currentIndex;
  }

  if (currentIndex === fromIndex) {
    return toIndex;
  }

  if (fromIndex < toIndex && currentIndex > fromIndex && currentIndex <= toIndex) {
    return currentIndex - 1;
  }

  if (fromIndex > toIndex && currentIndex >= toIndex && currentIndex < fromIndex) {
    return currentIndex + 1;
  }

  return currentIndex;
}

