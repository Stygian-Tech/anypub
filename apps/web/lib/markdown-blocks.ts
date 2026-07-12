export type MarkdownBlockKind =
  | "empty"
  | "heading"
  | "thematic-break"
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "code"
  | "paragraph";

export type MarkdownBlockSummary = {
  kind: MarkdownBlockKind;
  headingLevel?: number;
};

type BaseMarkdownBlock = {
  source: string;
};

export type MarkdownBlock =
  | (BaseMarkdownBlock & { kind: "empty" })
  | (BaseMarkdownBlock & { kind: "heading"; headingLevel: number })
  | (BaseMarkdownBlock & { kind: "thematic-break" })
  | (BaseMarkdownBlock & { kind: "quote" })
  | (BaseMarkdownBlock & { kind: "unordered-list"; listLevel: number })
  | (BaseMarkdownBlock & { kind: "ordered-list"; listLevel: number; listStart: number })
  | (BaseMarkdownBlock & { kind: "code"; language?: string })
  | (BaseMarkdownBlock & { kind: "paragraph" });

type MarkdownBlockInput = MarkdownBlock | string;

export function splitMarkdownBlocks(markdown: string) {
  return parseMarkdownBlocks(markdown).map((block) => block.source);
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!normalized.trim()) {
    return [];
  }

  return normalized
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.trim())
    .flatMap(splitListItems)
    .map(parseMarkdownBlock);
}

export function parseMarkdownBlock(source: string): MarkdownBlock {
  const rawSource = source.replace(/\r\n?/g, "\n");
  const trimmed = rawSource.trim();
  if (!trimmed) {
    return { kind: "empty", source };
  }

  const code = trimmed.match(/^```(\w*)\n?[\s\S]*```$/);
  if (code) {
    return { kind: "code", source: trimmed, language: code[1] || undefined };
  }

  const lines = rawSource.split("\n").filter((line) => line.trim());
  if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(rawSource)) {
    return { kind: "thematic-break", source: trimmed };
  }

  const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (heading && lines.length === 1) {
    return { kind: "heading", source: trimmed, headingLevel: heading[1]?.length ?? 1 };
  }

  if (lines.every((line) => /^\s{0,3}>\s?/.test(line))) {
    return { kind: "quote", source: trimmed };
  }

  const unorderedList = lines[0]?.match(/^([ \t]*)([-*+])(?:\s+(.*)|\s*)$/);
  if (unorderedList && lines.every((line) => /^([ \t]*)([-*+])(?:\s+(.*)|\s*)$/.test(line))) {
    return {
      kind: "unordered-list",
      source: rawSource,
      listLevel: indentToListLevel(unorderedList[1] ?? ""),
    };
  }

  const orderedList = lines[0]?.match(/^([ \t]*)(\d+)\.(?:\s+(.*)|\s*)$/);
  if (orderedList && lines.every((line) => /^([ \t]*)(\d+)\.(?:\s+(.*)|\s*)$/.test(line))) {
    return {
      kind: "ordered-list",
      source: rawSource,
      listLevel: indentToListLevel(orderedList[1] ?? ""),
      listStart: Number(orderedList[2] ?? 1),
    };
  }

  return { kind: "paragraph", source: trimmed };
}

export function isListMarkdownBlock(block: MarkdownBlock): block is Extract<MarkdownBlock, { kind: "unordered-list" | "ordered-list" }> {
  return block.kind === "unordered-list" || block.kind === "ordered-list";
}

export function setMarkdownBlockListLevel(block: MarkdownBlock, listLevel: number): MarkdownBlock {
  if (!isListMarkdownBlock(block)) {
    return block;
  }

  const boundedLevel = Math.max(0, Math.min(4, listLevel));
  const sourceWithoutIndent = block.source.replace(/^[ \t]*/, "");
  return parseMarkdownBlock(`${listLevelToIndent(boundedLevel)}${sourceWithoutIndent}`);
}

export function isEmptyListMarkdownBlock(
  block: MarkdownBlock,
): block is Extract<MarkdownBlock, { kind: "unordered-list" | "ordered-list" }> {
  return isListMarkdownBlock(block) && !block.source.replace(/^[ \t]*(?:[-*+]|\d+\.)\s*/, "").trim();
}

export function outdentEmptyListMarkdownBlock(block: MarkdownBlock) {
  if (!isEmptyListMarkdownBlock(block)) {
    return block;
  }

  return block.listLevel > 0
    ? setMarkdownBlockListLevel(block, block.listLevel - 1)
    : parseMarkdownBlock("");
}

export function splitMarkdownBlockAtCursor(
  block: MarkdownBlock,
  selectionStart: number,
  selectionEnd = selectionStart,
): [MarkdownBlock, MarkdownBlock] {
  if (isListMarkdownBlock(block)) {
    return splitListBlockAtCursor(block, selectionStart, selectionEnd);
  }

  const source = block.source;
  const start = clamp(selectionStart, 0, source.length);
  const end = clamp(selectionEnd, start, source.length);

  return [parseMarkdownBlock(source.slice(0, start)), parseMarkdownBlock(source.slice(end))];
}

export function compactMarkdownBlocks<T extends MarkdownBlockInput>(blocks: T[]) {
  return blocks.filter((block) => getBlockSource(block).trim());
}

export function joinMarkdownBlocks(blocks: MarkdownBlockInput[]) {
  return compactMarkdownBlocks(blocks)
    .map(serializeMarkdownBlock)
    .reduce((markdown, block) => {
      if (!markdown) {
        return block;
      }

      const previousBlock = markdown.split(/\n\n/).at(-1) ?? "";
      const separator = shouldJoinWithSingleNewline(previousBlock, block) ? "\n" : "\n\n";
      return `${markdown}${separator}${block}`;
    }, "");
}

export function moveMarkdownBlock<T extends MarkdownBlockInput>(
  blocks: T[],
  fromIndex: number,
  toIndex: number,
  options: { targetListLevel?: number } = {},
) {
  const compactedBlocks = compactMarkdownBlocks(blocks);
  const movingBlock = compactedBlocks[fromIndex];
  if (
    fromIndex < 0 ||
    fromIndex >= compactedBlocks.length ||
    toIndex < 0 ||
    toIndex >= compactedBlocks.length ||
    fromIndex === toIndex ||
    !movingBlock
  ) {
    return compactedBlocks;
  }

  const nextBlocks = [...compactedBlocks];
  const groupEndIndex = findMovableGroupEnd(compactedBlocks, fromIndex);
  if (toIndex > fromIndex && toIndex < groupEndIndex) {
    return compactedBlocks;
  }

  const movedBlocks = nextBlocks.splice(fromIndex, groupEndIndex - fromIndex);
  const insertionIndex = fromIndex < toIndex ? toIndex - movedBlocks.length + 1 : toIndex;
  const normalizedBlocks = normalizeMovedListLevels(movedBlocks, options.targetListLevel);

  nextBlocks.splice(insertionIndex, 0, ...normalizedBlocks);
  return nextBlocks;
}

export function summarizeMarkdownBlock(block: string): MarkdownBlockSummary {
  const parsedBlock = parseMarkdownBlock(block);
  if (parsedBlock.kind === "heading") {
    return { kind: parsedBlock.kind, headingLevel: parsedBlock.headingLevel };
  }

  return { kind: parsedBlock.kind };
}

function splitListItems(block: string) {
  const summary = summarizeMarkdownBlock(block);
  if (summary.kind !== "unordered-list" && summary.kind !== "ordered-list") {
    return [block];
  }

  return block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
}

function shouldJoinWithSingleNewline(previousBlock: string, block: string) {
  const previousKind = summarizeMarkdownBlock(previousBlock).kind;
  const nextKind = summarizeMarkdownBlock(block).kind;

  return previousKind === nextKind && isListKind(previousKind);
}

function getBlockSource(block: MarkdownBlockInput) {
  return typeof block === "string" ? block : block.source;
}

function isListKind(kind: MarkdownBlockKind) {
  return kind === "unordered-list" || kind === "ordered-list";
}

function serializeMarkdownBlock(block: MarkdownBlockInput) {
  const parsedBlock = typeof block === "string" ? parseMarkdownBlock(block) : block;
  return isListMarkdownBlock(parsedBlock) ? parsedBlock.source.trimEnd() : parsedBlock.source.trim();
}

function indentToListLevel(indent: string) {
  const tabs = indent.match(/\t/g)?.length ?? 0;
  const spaces = indent.replace(/\t/g, "").length;
  return tabs + Math.floor(spaces / 2);
}

function listLevelToIndent(listLevel: number) {
  return "\t".repeat(Math.max(0, listLevel));
}

function splitListBlockAtCursor(
  block: Extract<MarkdownBlock, { kind: "unordered-list" | "ordered-list" }>,
  selectionStart: number,
  selectionEnd: number,
): [MarkdownBlock, MarkdownBlock] {
  const source = block.source.replace(/\r\n?/g, "\n");
  const prefix = source.match(/^([ \t]*)([-*+]|\d+\.)\s*/);
  const indent = prefix?.[1] ?? listLevelToIndent(block.listLevel);
  const currentMarker = block.kind === "ordered-list" ? `${block.listStart}.` : prefix?.[2] ?? "-";
  const nextMarker = block.kind === "ordered-list" ? `${block.listStart + 1}.` : currentMarker;
  const contentStart = prefix?.[0].length ?? `${indent}${currentMarker} `.length;
  const content = source.slice(contentStart);
  const start = clamp(selectionStart - contentStart, 0, content.length);
  const end = clamp(selectionEnd - contentStart, start, content.length);

  return [
    parseMarkdownBlock(`${indent}${currentMarker} ${content.slice(0, start)}`),
    parseMarkdownBlock(`${indent}${nextMarker} ${content.slice(end)}`),
  ];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function findMovableGroupEnd<T extends MarkdownBlockInput>(blocks: T[], fromIndex: number) {
  const block = blocks[fromIndex];
  if (typeof block === "string") {
    return fromIndex + 1;
  }

  if (!isListMarkdownBlock(block)) {
    return fromIndex + 1;
  }

  let index = fromIndex + 1;
  while (index < blocks.length) {
    const nextBlock = blocks[index];
    if (typeof nextBlock === "string" || !isListMarkdownBlock(nextBlock) || nextBlock.listLevel <= block.listLevel) {
      break;
    }
    index += 1;
  }

  return index;
}

function normalizeMovedListLevels<T extends MarkdownBlockInput>(blocks: T[], targetListLevel?: number) {
  const firstBlock = blocks[0];
  if (targetListLevel === undefined || typeof firstBlock === "string" || !isListMarkdownBlock(firstBlock)) {
    return blocks;
  }

  const levelDelta = Math.max(0, Math.min(4, targetListLevel)) - firstBlock.listLevel;
  if (levelDelta === 0) {
    return blocks;
  }

  return blocks.map((block) => {
    if (typeof block === "string" || !isListMarkdownBlock(block)) {
      return block;
    }

    return setMarkdownBlockListLevel(block, block.listLevel + levelDelta) as T;
  });
}
