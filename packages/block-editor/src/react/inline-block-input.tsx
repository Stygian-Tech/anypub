"use client";

import * as React from "react";
import { cn } from "../utils.js";
import { Textarea } from "./primitives.js";

export function InlineMarkdownBlockTextarea({
  id,
  value,
  invalid,
  compact,
  initialCaret,
  onBlur,
  onChange,
  onKeyDown,
  onPaste,
}: {
  id: string;
  value: string;
  invalid: boolean;
  compact: boolean;
  initialCaret?: number | null;
  onBlur: () => void;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const initialCaretApplied = React.useRef(false);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || initialCaretApplied.current) {
      return;
    }

    initialCaretApplied.current = true;
    const caret = initialCaret ?? textarea.value.length;
    textarea.setSelectionRange(caret, caret);
  }, [initialCaret]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [compact, value]);

  return (
    <Textarea
      ref={textareaRef}
      id={id}
      data-testid="markdown-block-textarea"
      autoFocus
      value={value}
      aria-invalid={invalid}
      rows={1}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={cn(
        "min-h-0 min-w-0 flex-1 resize-none overflow-hidden rounded-none border-0 bg-transparent pr-3 pl-0 !text-base !leading-7 shadow-none focus-visible:ring-0",
        compact ? "py-0" : "py-2",
      )}
    />
  );
}

export function caretOffsetFromPreviewClick(
  event: React.MouseEvent<HTMLButtonElement>,
  editableSource: string,
) {
  const preview = event.currentTarget;
  const previewOffset = previewTextOffsetFromPoint(preview, event.clientX, event.clientY);
  if (previewOffset === null) {
    return null;
  }

  return mapPreviewOffsetToSourceOffset(editableSource, preview.textContent ?? "", previewOffset);
}

function previewTextOffsetFromPoint(root: HTMLElement, clientX: number, clientY: number) {
  const doc = root.ownerDocument;
  const caretDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  let node: Node | null = null;
  let offset = 0;
  const position = caretDoc.caretPositionFromPoint?.(clientX, clientY);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) {
    return null;
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) {
      return total + offset;
    }
    total += walker.currentNode.textContent?.length ?? 0;
  }

  return null;
}

// The preview strips markdown syntax, so its text is a subsequence of the source;
// consume matching characters until the clicked preview offset is reached.
function mapPreviewOffsetToSourceOffset(source: string, previewText: string, previewOffset: number) {
  const boundedOffset = Math.max(0, Math.min(previewOffset, previewText.length));
  let sourceIndex = 0;
  let previewIndex = 0;

  while (sourceIndex < source.length && previewIndex < boundedOffset) {
    if (source[sourceIndex] === previewText[previewIndex]) {
      previewIndex += 1;
    }
    sourceIndex += 1;
  }

  return sourceIndex;
}
