"use client";

import * as React from "react";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import {
  compactMarkdownBlocks,
  getMarkdownBlockSubtreeEnd,
  isEmptyListMarkdownBlock,
  isListMarkdownBlock,
  joinMarkdownBlocks,
  moveMarkdownBlock,
  moveMarkdownBlockToInsertion,
  orderedListOrdinalAt,
  outdentEmptyListMarkdownBlock,
  parseMarkdownBlock,
  parseMarkdownBlocks,
  setMarkdownBlockListLevel,
  shouldInsertCodeBlockSoftBreak,
  splitMarkdownBlockAtCursor,
  type MarkdownBlock,
  type BlockDocument,
  reviseMarkdownDocument,
} from "../model/index.js";
import { cn } from "../utils.js";
import { Field, FieldDescription } from "./primitives.js";
import {
  MarkdownBlockPreview,
  MarkdownListEditingMarker,
  type ImageURLResolver,
} from "./block-renderer.js";
import { caretOffsetFromPreviewClick, InlineMarkdownBlockTextarea } from "./inline-block-input.js";
import {
  BlockDragHandle,
  BlockDropIndicator,
  markdownBlockEditorPrefix,
  reindexAfterMove,
} from "./block-drag.js";

export type BlockEditorHandle = {
  insertBlock: (markdown: string, atIndex?: number) => void;
};

export type ImageFilesHandler = (files: File[], insertionIndex: number) => void | Promise<void>;

export type BlockEditorProps = {
  document: BlockDocument;
  invalid?: boolean;
  onChange: (document: BlockDocument) => void;
  resolveImageURL?: ImageURLResolver;
  onImageFiles?: ImageFilesHandler;
};

export type MarkdownBlockEditorProps = {
  value: string;
  invalid?: boolean;
  onChange: (markdown: string) => void;
  resolveImageURL?: ImageURLResolver;
  onImageFiles?: ImageFilesHandler;
};

export const BlockEditor = React.forwardRef<BlockEditorHandle, BlockEditorProps>(function BlockEditor({
  document,
  invalid = false,
  onChange,
  resolveImageURL,
  onImageFiles,
}, ref) {
  return (
    <MarkdownBlockEditor
      ref={ref}
      value={document.markdown}
      invalid={invalid}
      resolveImageURL={resolveImageURL}
      onImageFiles={onImageFiles}
      onChange={(markdown) => onChange(reviseMarkdownDocument(document, markdown))}
    />
  );
});

export const MarkdownBlockEditor = React.forwardRef<BlockEditorHandle, MarkdownBlockEditorProps>(function MarkdownBlockEditor({
  value,
  invalid = false,
  onChange,
  resolveImageURL,
  onImageFiles,
}, ref) {
  const [blocks, setBlocks] = React.useState(() => parseMarkdownBlocks(value));
  const [activeBlockIndex, setActiveBlockIndex] = React.useState<number | null>(null);
  const [draggedBlockIndex, setDraggedBlockIndex] = React.useState<number | null>(null);
  const [dragInsertionIndex, setDragInsertionIndex] = React.useState<number | null>(null);
  const [dragTargetListLevel, setDragTargetListLevel] = React.useState(0);
  const [pendingCaret, setPendingCaret] = React.useState<number | null>(null);
  const [imageDragActive, setImageDragActive] = React.useState(false);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const dragStateRef = React.useRef<{
    fromIndex: number;
    insertionIndex: number | null;
    startX: number;
    targetListLevel?: number;
  } | null>(null);
  const draggedSubtreeEnd = draggedBlockIndex === null
    ? null
    : getMarkdownBlockSubtreeEnd(blocks, draggedBlockIndex);

  function commitBlocks(nextBlocks: MarkdownBlock[], preserveEmptyIndexes?: number | number[]) {
    const preservedIndexes = new Set(
      Array.isArray(preserveEmptyIndexes)
        ? preserveEmptyIndexes
        : preserveEmptyIndexes === undefined
          ? []
          : [preserveEmptyIndexes],
    );
    const committedBlocks = nextBlocks.filter((block, index) => block.source.trim() || preservedIndexes.has(index));

    setBlocks(committedBlocks);
    onChange(joinMarkdownBlocks(committedBlocks));
  }

  function deleteEmptyBlocks() {
    const compactedBlocks = compactMarkdownBlocks(blocks);
    setBlocks(compactedBlocks);
    onChange(joinMarkdownBlocks(compactedBlocks));
    setActiveBlockIndex(null);
  }

  function setActiveBlock(index: number, caretOffset: number | null = null) {
    setPendingCaret(caretOffset);
    const compactedBlocks = compactMarkdownBlocks(blocks);
    if (compactedBlocks.length !== blocks.length) {
      setBlocks(compactedBlocks);
      onChange(joinMarkdownBlocks(compactedBlocks));
    }
    setActiveBlockIndex(Math.min(index, compactedBlocks.length - 1));
  }

  function addEmptyBlock(afterIndex: number) {
    setPendingCaret(null);
    const compactedBlocks = compactMarkdownBlocks(blocks);
    const boundedAfterIndex = Math.min(Math.max(afterIndex, -1), compactedBlocks.length - 1);
    const insertAt = boundedAfterIndex + 1;
    const nextBlocks = [...compactedBlocks];
    nextBlocks.splice(insertAt, 0, parseMarkdownBlock(""));

    setBlocks(nextBlocks);
    onChange(joinMarkdownBlocks(nextBlocks));
    setActiveBlockIndex(insertAt);
  }

  React.useImperativeHandle(ref, () => ({
    insertBlock(markdown: string, atIndex?: number) {
      const compactedBlocks = compactMarkdownBlocks(blocks);
      const insertAt = atIndex === undefined
        ? activeBlockIndex === null ? compactedBlocks.length : Math.min(activeBlockIndex + 1, compactedBlocks.length)
        : Math.max(0, Math.min(atIndex, compactedBlocks.length));
      const nextBlocks = [...compactedBlocks];
      nextBlocks.splice(insertAt, 0, parseMarkdownBlock(markdown));
      setBlocks(nextBlocks);
      onChange(joinMarkdownBlocks(nextBlocks));
      setActiveBlockIndex(null);
    },
  }), [activeBlockIndex, blocks, onChange]);

  function imageFilesFromTransfer(transfer: DataTransfer | null) {
    return Array.from(transfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
  }

  function hasImageTransfer(transfer: DataTransfer | null) {
    return imageFilesFromTransfer(transfer).length > 0 || Array.from(transfer?.items ?? []).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
  }

  function imageInsertionIndex(clientY?: number) {
    const editor = editorRef.current;
    if (!editor || clientY === undefined) {
      return activeBlockIndex === null ? blocks.length : Math.min(activeBlockIndex + 1, blocks.length);
    }

    const rows = Array.from(editor.querySelectorAll<HTMLElement>("[data-block-index]"));
    const nextRow = rows.find((row) => {
      const bounds = row.getBoundingClientRect();
      return clientY < bounds.top + bounds.height / 2;
    });
    return nextRow ? Number(nextRow.dataset.blockIndex) : rows.length;
  }

  function updateBlock(index: number, nextValue: string) {
    updateParsedBlock(index, parseMarkdownBlock(nextValue));
  }

  function updateParsedBlock(index: number, nextBlock: MarkdownBlock) {
    const nextBlocks = [...blocks];
    nextBlocks[index] = nextBlock;
    commitBlocks(nextBlocks, index);
  }

  function moveBlock(fromIndex: number, toIndex: number, targetListLevel?: number) {
    const compactedBlocks = compactMarkdownBlocks(blocks);
    if (
      fromIndex < 0 ||
      fromIndex >= compactedBlocks.length ||
      toIndex < 0 ||
      toIndex >= compactedBlocks.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const movedBlocks = moveMarkdownBlock(blocks, fromIndex, toIndex, { targetListLevel });
    setBlocks(movedBlocks);
    onChange(joinMarkdownBlocks(movedBlocks));
    setActiveBlockIndex((currentIndex) => reindexAfterMove(currentIndex, fromIndex, toIndex));
  }

  function moveBlockToInsertion(fromIndex: number, insertionIndex: number, targetListLevel?: number) {
    const movedBlocks = moveMarkdownBlockToInsertion(blocks, fromIndex, insertionIndex, { targetListLevel });
    setBlocks(movedBlocks);
    onChange(joinMarkdownBlocks(movedBlocks));
    setActiveBlockIndex(null);
  }

  function startDraggingBlock(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const draggedBlock = blocks[index];
    dragStateRef.current = {
      fromIndex: index,
      insertionIndex: index,
      startX: event.clientX,
      targetListLevel: draggedBlock && isListMarkdownBlock(draggedBlock) ? draggedBlock.listLevel : undefined,
    };
    setDraggedBlockIndex(index);
    setDragInsertionIndex(index);
    setDragTargetListLevel(draggedBlock && isListMarkdownBlock(draggedBlock) ? draggedBlock.listLevel : 0);

    const ownerDocument = event.currentTarget.ownerDocument;
    const dragHandle = event.currentTarget;
    dragHandle.dataset.dragMoved = "false";
    const editor = dragHandle.closest<HTMLElement>("[data-testid='markdown-block-editor']");

    function updateDragTarget(pointerEvent: PointerEvent, markMoved = true) {
      if (markMoved) dragHandle.dataset.dragMoved = "true";
      if (!editor) {
        return;
      }

      const rows = Array.from(editor.querySelectorAll<HTMLElement>("[data-block-index]"));
      const nextRow = rows.find((row) => {
        const bounds = row.getBoundingClientRect();
        return pointerEvent.clientY < bounds.top + bounds.height / 2;
      });
      const insertionIndex = nextRow ? Number(nextRow.dataset.blockIndex) : rows.length;
      const currentDragState = dragStateRef.current;
      const targetListLevel = resolveDraggedListLevel(index, insertionIndex, pointerEvent.clientX, currentDragState?.startX);
      dragStateRef.current = { fromIndex: index, insertionIndex, startX: currentDragState?.startX ?? event.clientX, targetListLevel };
      setDragInsertionIndex(insertionIndex);
      setDragTargetListLevel(targetListLevel ?? 0);
    }

    function finishDragging(pointerEvent: PointerEvent) {
      updateDragTarget(pointerEvent, false);
      const dragState = dragStateRef.current;
      if (dragState?.insertionIndex !== null && dragState?.insertionIndex !== undefined) {
        moveBlockToInsertion(dragState.fromIndex, dragState.insertionIndex, dragState.targetListLevel);
      }

      dragStateRef.current = null;
      setDraggedBlockIndex(null);
      setDragInsertionIndex(null);
      setDragTargetListLevel(0);
      if (dragHandle.hasPointerCapture(pointerEvent.pointerId)) {
        dragHandle.releasePointerCapture(pointerEvent.pointerId);
      }
      ownerDocument.removeEventListener("pointermove", updateDragTarget);
      ownerDocument.removeEventListener("pointerup", finishDragging);
      ownerDocument.removeEventListener("pointercancel", cancelDragging);
    }

    function cancelDragging(pointerEvent: PointerEvent) {
      dragStateRef.current = null;
      setDraggedBlockIndex(null);
      setDragInsertionIndex(null);
      setDragTargetListLevel(0);
      if (dragHandle.hasPointerCapture(pointerEvent.pointerId)) {
        dragHandle.releasePointerCapture(pointerEvent.pointerId);
      }
      ownerDocument.removeEventListener("pointermove", updateDragTarget);
      ownerDocument.removeEventListener("pointerup", finishDragging);
      ownerDocument.removeEventListener("pointercancel", cancelDragging);
    }

    ownerDocument.addEventListener("pointermove", updateDragTarget);
    ownerDocument.addEventListener("pointerup", finishDragging);
    ownerDocument.addEventListener("pointercancel", cancelDragging);
  }

  function resolveDraggedListLevel(fromIndex: number, insertionIndex: number, clientX: number, startX?: number) {
    const draggedBlock = blocks[fromIndex];
    if (!draggedBlock || !isListMarkdownBlock(draggedBlock)) {
      return undefined;
    }

    if (insertionIndex <= 0) {
      return 0;
    }

    const levelDelta = Math.round((clientX - (startX ?? clientX)) / 28);
    return Math.max(0, Math.min(4, draggedBlock.listLevel + levelDelta));
  }

  function changeListLevel(index: number, delta: number) {
    const block = blocks[index];
    if (!block || !isListMarkdownBlock(block)) {
      return false;
    }

    updateParsedBlock(index, setMarkdownBlockListLevel(block, block.listLevel + delta));
    return true;
  }

  function toggleTaskItem(index: number, lineIndex: number) {
    const block = blocks[index];
    if (!block || !isListMarkdownBlock(block)) {
      return;
    }

    const lines = block.source.split("\n");
    const line = lines[lineIndex];
    if (!line) {
      return;
    }

    lines[lineIndex] = line.replace(
      /^([ \t]*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/,
      (_, prefix: string, state: string) => `${prefix}[${state === " " ? "x" : " "}]`,
    );
    updateParsedBlock(index, parseMarkdownBlock(lines.join("\n")));
  }

  function insertTabText(index: number, event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const nextValue = `${target.value.slice(0, selectionStart)}\t${target.value.slice(selectionEnd)}`;
    updateBlock(index, nextValue);
  }

  function insertBlockBreak(index: number, event: React.KeyboardEvent<HTMLTextAreaElement>, selectionOffset = 0) {
    const block = blocks[index];
    if (!block) {
      return;
    }

    const target = event.currentTarget;
    const nextBlocks = [...blocks];
    const splitBlocks = splitMarkdownBlockAtCursor(
      block,
      target.selectionStart + selectionOffset,
      target.selectionEnd + selectionOffset,
    );

    nextBlocks.splice(index, 1, ...splitBlocks);
    commitBlocks(nextBlocks, [index, index + 1]);
    setPendingCaret(null);
    setActiveBlockIndex(index + 1);
  }

  function insertSoftBreak(index: number, event: React.KeyboardEvent<HTMLTextAreaElement>, sourceIndent = "") {
    const block = blocks[index];
    if (!block) {
      return;
    }

    const target = event.currentTarget;
    const insertion = block.kind === "quote" ? "\n> " : "\n";
    const nextValue = `${target.value.slice(0, target.selectionStart)}${insertion}${target.value.slice(target.selectionEnd)}`;
    const nextCaret = target.selectionStart + insertion.length;

    updateBlock(index, sourceIndent + nextValue);
    target.ownerDocument.defaultView?.requestAnimationFrame(() => {
      target.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function deleteEmptyBlock(index: number) {
    if (index <= 0 || blocks[index]?.source.trim()) {
      return false;
    }

    const previousBlock = blocks[index - 1];
    if (!previousBlock) {
      return false;
    }

    const nextBlocks = blocks.filter((_, blockIndex) => blockIndex !== index);
    const previousIndent = isListMarkdownBlock(previousBlock)
      ? previousBlock.source.match(/^[ \t]*/)?.[0].length ?? 0
      : 0;

    commitBlocks(nextBlocks);
    setPendingCaret(previousBlock.source.length - previousIndent);
    setActiveBlockIndex(index - 1);
    return true;
  }

  function exitEmptyListItem(index: number) {
    const block = blocks[index];
    if (!block || !isEmptyListMarkdownBlock(block)) {
      return false;
    }

    const nextBlocks = [...blocks];
    nextBlocks[index] = outdentEmptyListMarkdownBlock(block);
    commitBlocks(nextBlocks, index);
    setPendingCaret(null);
    setActiveBlockIndex(index);
    return true;
  }

  function moveToPreviousBlock(index: number) {
    const previousBlock = blocks[index - 1];
    if (!previousBlock) {
      return false;
    }

    setPendingCaret(previousBlock.source.length - markdownBlockEditorPrefix(previousBlock).length);
    setActiveBlockIndex(index - 1);
    return true;
  }

  return (
    <Field data-invalid={invalid} className="min-h-0 flex-1">
      <label data-slot="field-label" htmlFor="markdown-block-0" className="text-sm font-medium leading-none sr-only">Markdown</label>
      <div
        ref={editorRef}
        data-testid="markdown-block-editor"
        data-image-drag-active={imageDragActive ? "true" : undefined}
        className={cn(
          "relative flex min-h-[64vh] flex-1 flex-col px-0 py-4 transition-colors",
          imageDragActive && "bg-accent/40 ring-primary/40 ring-2 ring-inset",
        )}
        onDragEnter={(event) => {
          if (!onImageFiles || !hasImageTransfer(event.dataTransfer)) return;
          event.preventDefault();
          setImageDragActive(true);
        }}
        onDragOver={(event) => {
          if (!onImageFiles || !hasImageTransfer(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setImageDragActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setImageDragActive(false);
        }}
        onDrop={(event) => {
          const files = imageFilesFromTransfer(event.dataTransfer);
          if (!onImageFiles || files.length === 0) return;
          event.preventDefault();
          setImageDragActive(false);
          void onImageFiles(files, imageInsertionIndex(event.clientY));
        }}
        onPaste={(event) => {
          const files = imageFilesFromTransfer(event.clipboardData);
          if (!onImageFiles || files.length === 0) return;
          event.preventDefault();
          void onImageFiles(files, imageInsertionIndex());
        }}
      >
        {imageDragActive ? (
          <div
            data-testid="markdown-image-drop-overlay"
            className="text-primary pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full border bg-background/95 px-3 py-1.5 text-sm font-medium shadow-sm"
          >
            Drop images to add them
          </div>
        ) : null}
        {blocks.map((block, index) => {
          const isActive = index === activeBlockIndex;
          const isListItem = isListMarkdownBlock(block);
          const listLevel = isListItem ? block.listLevel : 0;
          const editorPrefix = markdownBlockEditorPrefix(block);
          const editableSource = block.source.slice(editorPrefix.length);
          const orderedListOrdinal = block.kind === "ordered-list" ? orderedListOrdinalAt(blocks, index) : undefined;

          return (
            <React.Fragment key={`${index}-${blocks.length}`}>
              <BlockDropIndicator
                active={draggedBlockIndex !== null && dragInsertionIndex === index}
                listLevel={dragTargetListLevel}
              />
              <div
              data-testid="markdown-block-row"
              data-block-index={index}
              data-list-block={isListItem ? "true" : undefined}
              data-list-level={isListItem ? listLevel : undefined}
              style={{ marginLeft: isListItem && listLevel > 0 ? `${listLevel * 28}px` : undefined }}
              className={cn(
                "group/block relative flex items-start gap-0",
                isListItem ? "rounded-sm" : "my-0.5 rounded-md",
                draggedBlockIndex !== null &&
                  draggedSubtreeEnd !== null &&
                  index >= draggedBlockIndex &&
                  index < draggedSubtreeEnd &&
                  "opacity-50",
              )}
            >
              <BlockDragHandle
                index={index}
                block={block}
                onPointerDown={startDraggingBlock}
                onMove={moveBlock}
              />
              {isActive ? (
                <div
                  className={cn(
                    "bg-accent/70 flex min-w-0 flex-1 cursor-text items-start gap-2.5 rounded-md pl-1 transition-colors",
                    block.kind === "code" && "flex-col gap-0 p-2",
                  )}
                >
                  {block.kind === "code" ? (
                    <div className="pointer-events-none w-full" aria-hidden="true">
                      <MarkdownBlockPreview block={block} resolveImageURL={resolveImageURL} />
                    </div>
                  ) : isListItem ? (
                    <MarkdownListEditingMarker block={block} orderedListOrdinal={orderedListOrdinal} />
                  ) : null}
                  <InlineMarkdownBlockTextarea
                    id={`markdown-block-${index}`}
                    value={editableSource}
                    invalid={invalid}
                    initialCaret={pendingCaret}
                    onBlur={deleteEmptyBlocks}
                    onChange={(nextValue) => updateBlock(index, editorPrefix + nextValue)}
                    onPaste={(event) => {
                      if (block.kind === "code") return;
                      const url = event.clipboardData.getData("text/plain").trim();
                      if (!/^https?:\/\/\S+$/i.test(url)) return;
                      event.preventDefault();
                      const target = event.currentTarget;
                      const insertion = `[${url}](${url})`;
                      const nextValue = `${target.value.slice(0, target.selectionStart)}${insertion}${target.value.slice(target.selectionEnd)}`;
                      updateBlock(index, editorPrefix + nextValue);
                      const caret = target.selectionStart + insertion.length;
                      target.ownerDocument.defaultView?.requestAnimationFrame(() => target.setSelectionRange(caret, caret));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Tab") {
                        event.preventDefault();
                        if (event.shiftKey) {
                          if (!changeListLevel(index, -1)) {
                            insertTabText(index, event);
                          }
                          return;
                        }

                        if (isListItem) {
                          changeListLevel(index, 1);
                          return;
                        }

                        if (!block.source.trim()) {
                          updateBlock(index, "\t- ");
                          return;
                        }

                        insertTabText(index, event);
                        return;
                      }

                      if (event.key === "Escape") {
                        event.preventDefault();
                        deleteEmptyBlocks();
                      }
                      if (
                        (event.key === "ArrowLeft" || event.key === "ArrowUp") &&
                        event.currentTarget.selectionStart === 0 &&
                        event.currentTarget.selectionEnd === 0
                      ) {
                        if (moveToPreviousBlock(index)) {
                          event.preventDefault();
                        }
                        return;
                      }
                      if (event.key === "Backspace" && isEmptyListMarkdownBlock(block)) {
                        event.preventDefault();
                        exitEmptyListItem(index);
                        return;
                      }
                      if (event.key === "Backspace" && !event.currentTarget.value) {
                        if (deleteEmptyBlock(index)) {
                          event.preventDefault();
                        }
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (event.shiftKey || shouldInsertCodeBlockSoftBreak(block, event.currentTarget.selectionStart)) {
                          insertSoftBreak(index, event, editorPrefix);
                          return;
                        }
                        if (exitEmptyListItem(index)) {
                          return;
                        }
                        insertBlockBreak(index, event, editorPrefix.length);
                      }
                    }}
                    compact={isListItem || block.kind === "code"}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="markdown-block-preview"
                  onClick={(event) => setActiveBlock(index, caretOffsetFromPreviewClick(event, editableSource))}
                  className={cn(
                    "focus-visible:bg-accent/70 block min-w-0 flex-1 !cursor-text pl-1 text-left outline-none transition-colors",
                    isListItem ? "rounded-sm py-0 pr-3" : "rounded-md py-2 pr-3",
                    invalid && !block.source.trim() && "ring-destructive/35 ring-1",
                  )}
                >
                      <MarkdownBlockPreview
                        block={block}
                        orderedListOrdinal={orderedListOrdinal}
                        onToggleTask={(lineIndex) => toggleTaskItem(index, lineIndex)}
                        resolveImageURL={resolveImageURL}
                      />
                </button>
              )}
              </div>
            </React.Fragment>
          );
        })}
        <BlockDropIndicator
          active={draggedBlockIndex !== null && dragInsertionIndex === blocks.length}
          listLevel={dragTargetListLevel}
        />
        <button
          type="button"
          data-testid="markdown-add-block"
          data-block-insertion-index={blocks.length}
          onClick={() => addEmptyBlock(blocks.length - 1)}
          className="group/add text-muted-foreground focus-visible:text-foreground flex min-h-24 w-full flex-1 !cursor-text items-start text-left text-sm outline-none transition-colors"
        >
          <span className="group/add-row relative flex min-h-11 w-full items-start py-3 pr-3 pl-8">
            <span
              aria-hidden="true"
              data-testid="markdown-add-block-handle"
              className="pointer-events-none absolute top-[0.6rem] left-0 flex size-7 items-center justify-center opacity-0 transition-opacity group-hover/add-row:opacity-100 group-focus-visible/add:opacity-100"
            >
              <GripVerticalIcon className="size-4" />
            </span>
            <span className="flex items-center gap-2">
              <PlusIcon data-icon="inline-start" className="size-4" />
              Add Block
            </span>
          </span>
        </button>
      </div>
      {invalid ? <FieldDescription>Markdown body is required.</FieldDescription> : null}
    </Field>
  );
});
