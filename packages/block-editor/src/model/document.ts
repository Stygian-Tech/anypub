import {
  joinMarkdownBlocks,
  parseMarkdownBlock,
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "./markdown-blocks.js";

export const blockDocumentSchemaVersion = 1 as const;

export type DocumentBlock = MarkdownBlock & { id: string };

export type BlockDocument = {
  schemaVersion: typeof blockDocumentSchemaVersion;
  revision: number;
  blocks: DocumentBlock[];
  markdown: string;
};

export class StaleBlockDocumentError extends Error {
  constructor(expectedRevision: number, receivedRevision: number) {
    super(`Expected block document revision ${expectedRevision}, received ${receivedRevision}.`);
    this.name = "StaleBlockDocumentError";
  }
}

export type BlockIDFactory = () => string;

let fallbackID = 0;

export function createBlockID() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackID += 1;
  return `block-${fallbackID}`;
}

export function importMarkdownDocument(
  markdown: string,
  options: { revision?: number; createID?: BlockIDFactory } = {},
): BlockDocument {
  const createID = options.createID ?? createBlockID;
  const blocks = parseMarkdownBlocks(markdown).map((block) => ({ ...block, id: createID() }));
  return createBlockDocument(blocks, options.revision ?? 0);
}

export function reviseMarkdownDocument(
  current: BlockDocument,
  markdown: string,
  expectedRevision = current.revision,
  createID: BlockIDFactory = createBlockID,
): BlockDocument {
  if (expectedRevision !== current.revision) {
    throw new StaleBlockDocumentError(current.revision, expectedRevision);
  }
  const parsed = parseMarkdownBlocks(markdown);
  const blocks = parsed.map((block, index) => ({
    ...block,
    id: current.blocks[index]?.id ?? createID(),
  }));
  return createBlockDocument(blocks, current.revision + 1);
}

export function createBlockDocument(blocks: DocumentBlock[], revision = 0): BlockDocument {
  return {
    schemaVersion: blockDocumentSchemaVersion,
    revision,
    blocks,
    markdown: joinMarkdownBlocks(blocks),
  };
}

export function reviseBlockDocument(
  current: BlockDocument,
  blocks: DocumentBlock[],
  expectedRevision = current.revision,
): BlockDocument {
  if (expectedRevision !== current.revision) {
    throw new StaleBlockDocumentError(current.revision, expectedRevision);
  }
  return createBlockDocument(blocks, current.revision + 1);
}

export function parseBlockDocument(value: unknown): BlockDocument {
  if (!isBlockDocument(value)) {
    throw new TypeError("Invalid block document snapshot.");
  }

  // Block fields other than id and source are derived. Reparse them so snapshots
  // written by an older package version pick up the current normalized shape.
  const normalized = createBlockDocument(
    value.blocks.map((block) => ({ ...parseMarkdownBlock(block.source), id: block.id })),
    value.revision,
  );
  if (normalized.markdown !== value.markdown) {
    throw new TypeError("Block document Markdown does not match its blocks.");
  }
  return normalized;
}

export function isBlockDocument(value: unknown): value is BlockDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BlockDocument>;
  return candidate.schemaVersion === blockDocumentSchemaVersion
    && Number.isSafeInteger(candidate.revision)
    && (candidate.revision ?? -1) >= 0
    && typeof candidate.markdown === "string"
    && Array.isArray(candidate.blocks)
    && candidate.blocks.every((block) => (
      block
      && typeof block.id === "string"
      && block.id.length > 0
      && typeof block.source === "string"
    ));
}
