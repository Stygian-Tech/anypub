export type MarkdownBlockKind =
  | "empty"
  | "heading"
  | "thematic-break"
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "code"
  | "image"
  | "embed"
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
  | (BaseMarkdownBlock & { kind: "image"; alt: string; url: string })
  | (BaseMarkdownBlock & { kind: "embed"; url: string })
  | (BaseMarkdownBlock & { kind: "paragraph" });

export type MarkdownBlockInput = MarkdownBlock | string;

export function splitMarkdownBlocks(markdown: string) {
  return parseMarkdownBlocks(markdown).map((block) => block.source);
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!normalized.trim()) {
    return [];
  }

  return splitBlockSources(normalized)
    .filter((block) => block.trim())
    .flatMap(splitListItems)
    .map(parseMarkdownBlock);
}

function splitBlockSources(markdown: string) {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const source = current.join("\n").replace(/^\n+|\n+$/g, "");
    if (source.trim()) {
      blocks.push(source);
    }
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,})/);
    if (fence) {
      current.push(line);
      if (fenceMatch && fenceMatch[1]!.length >= fence.length && line.slice(fenceMatch[0].length).trim() === "") {
        fence = null;
        flush();
      }
      continue;
    }

    if (fenceMatch) {
      flush();
      fence = fenceMatch[1] ?? "```";
      current.push(line);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

export function parseMarkdownBlock(source: string): MarkdownBlock {
  const rawSource = source.replace(/\r\n?/g, "\n");
  const trimmed = rawSource.trim();
  if (!trimmed) {
    return { kind: "empty", source };
  }

  const code = trimmed.match(/^```([^\s`]*)\n?[\s\S]*```$/);
  if (code) {
    return { kind: "code", source: rawSource, language: code[1] || undefined };
  }

  const image = trimmed.match(/^!\[([^\]]*)\]\((\S+)\)$/);
  if (image) {
    return { kind: "image", source: rawSource, alt: image[1] ?? "", url: image[2] ?? "" };
  }

  const embed = trimmed.match(/^@\[embed\]\((https?:\/\/[^\s)]+)\)$/i);
  if (embed) {
    return { kind: "embed", source: rawSource, url: embed[1] ?? "" };
  }

  const rawLines = rawSource.split("\n");
  const lines = rawLines.filter((line) => line.trim());
  if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(rawSource)) {
    return { kind: "thematic-break", source: rawSource };
  }

  const heading = rawLines[0]?.trim().match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    return { kind: "heading", source: rawSource, headingLevel: heading[1]?.length ?? 1 };
  }

  if (lines.every((line) => /^\s{0,3}>\s?/.test(line))) {
    return { kind: "quote", source: rawSource };
  }

  const unorderedList = rawLines[0]?.match(/^([ \t]*)([-*+])(?:\s+(.*)|\s*)$/);
  if (unorderedList && rawLines.slice(1).every((line) => !isListItemStart(line) || isUnorderedListItemStart(line))) {
    return {
      kind: "unordered-list",
      source: rawSource,
      listLevel: indentToListLevel(unorderedList[1] ?? ""),
    };
  }

  const orderedList = rawLines[0]?.match(/^([ \t]*)(\d+)\.(?:\s+(.*)|\s*)$/);
  if (orderedList && rawLines.slice(1).every((line) => !isListItemStart(line) || isOrderedListItemStart(line))) {
    return {
      kind: "ordered-list",
      source: rawSource,
      listLevel: indentToListLevel(orderedList[1] ?? ""),
      listStart: Number(orderedList[2] ?? 1),
    };
  }

  return { kind: "paragraph", source: rawSource };
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

export function shouldInsertCodeBlockSoftBreak(block: MarkdownBlock, selectionStart: number) {
  if (!/^\s{0,3}`{3,}/.test(block.source)) {
    return false;
  }

  const lines = block.source.split("\n");
  let offset = (lines[0]?.length ?? 0) + 1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s{0,3}`{3,}\s*$/.test(line)) {
      return selectionStart <= offset;
    }
    offset += line.length + 1;
  }

  return true;
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

export function orderedListOrdinalAt(blocks: MarkdownBlock[], targetIndex: number) {
  const counters: number[] = [];

  for (let index = 0; index <= targetIndex && index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || !isListMarkdownBlock(block)) {
      counters.length = 0;
      continue;
    }

    counters.length = block.listLevel + 1;
    if (block.kind === "ordered-list") {
      const current = counters[block.listLevel];
      counters[block.listLevel] = current
        ? current + 1
        : block.listLevel === 0
          ? block.listStart
          : 1;
    } else {
      counters[block.listLevel] = 0;
    }

    if (index === targetIndex && block.kind === "ordered-list") {
      return counters[block.listLevel];
    }
  }

  return 1;
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

  return moveMarkdownBlockToInsertion(
    compactedBlocks,
    fromIndex,
    fromIndex < toIndex ? toIndex + 1 : toIndex,
    options,
  );
}

export function moveMarkdownBlockToInsertion<T extends MarkdownBlockInput>(
  blocks: T[],
  fromIndex: number,
  insertionIndex: number,
  options: { targetListLevel?: number } = {},
) {
  const compactedBlocks = compactMarkdownBlocks(blocks);
  if (
    fromIndex < 0 ||
    fromIndex >= compactedBlocks.length ||
    insertionIndex < 0 ||
    insertionIndex > compactedBlocks.length
  ) {
    return compactedBlocks;
  }

  const groupEndIndex = getMarkdownBlockSubtreeEnd(compactedBlocks, fromIndex);
  if (insertionIndex >= fromIndex && insertionIndex <= groupEndIndex) {
    const movedBlocks = compactedBlocks.slice(fromIndex, groupEndIndex);
    const normalizedBlocks = normalizeMovedListLevels(movedBlocks, options.targetListLevel);
    return [
      ...compactedBlocks.slice(0, fromIndex),
      ...normalizedBlocks,
      ...compactedBlocks.slice(groupEndIndex),
    ];
  }

  const nextBlocks = [...compactedBlocks];
  const movedBlocks = nextBlocks.splice(fromIndex, groupEndIndex - fromIndex);
  const adjustedInsertionIndex = insertionIndex > groupEndIndex
    ? insertionIndex - movedBlocks.length
    : insertionIndex;
  const normalizedBlocks = normalizeMovedListLevels(movedBlocks, options.targetListLevel);

  nextBlocks.splice(adjustedInsertionIndex, 0, ...normalizedBlocks);
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
  const lines = block.split("\n");
  if (!isListItemStart(lines[0] ?? "")) {
    return [block];
  }

  const items: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isListItemStart(line) && current.length) {
      items.push(current.join("\n"));
      current = [];
    }
    current.push(line.trimEnd());
  }

  if (current.length) {
    items.push(current.join("\n"));
  }

  return items.filter((item) => item.trim());
}

function isListItemStart(line: string) {
  return isUnorderedListItemStart(line) || isOrderedListItemStart(line);
}

function isUnorderedListItemStart(line: string) {
  return /^([ \t]*)([-*+])(?:\s+(.*)|\s*)$/.test(line);
}

function isOrderedListItemStart(line: string) {
  return /^([ \t]*)(\d+)\.(?:\s+(.*)|\s*)$/.test(line);
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

export function getMarkdownBlockSubtreeEnd<T extends MarkdownBlockInput>(blocks: T[], fromIndex: number) {
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
