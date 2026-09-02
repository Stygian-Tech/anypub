import { importMarkdownDocument } from "@stygian/markdown-editor/model";
import type { MarginResearchAnnotation, SembleResearchCard } from "@/lib/research-api";
import type { Draft } from "@/lib/types";
import { markdownToPlaintext } from "@/lib/validation";

export type ResearchPostMaterial = {
  title: string;
  sourceURL?: string;
  quote?: string;
  comment?: string;
  author?: string;
};

export type ResearchPostParts = {
  quote: boolean;
  link: boolean;
  comment: boolean;
};

export function materialFromSemble(card: SembleResearchCard): ResearchPostMaterial {
  const sourceURL = safeSourceURL(card.url);
  return {
    title: cleanText(card.title) || sourceTitle(sourceURL),
    sourceURL,
    comment: cleanText(card.note),
    author: cleanText(card.author),
  };
}

export function materialFromMargin(annotation: MarginResearchAnnotation): ResearchPostMaterial {
  const sourceURL = safeSourceURL(annotation.source);
  return {
    title: cleanText(annotation.title) || sourceTitle(sourceURL),
    sourceURL,
    quote: cleanText(annotation.quote),
    comment: cleanText(annotation.body),
  };
}

export function researchMarkdown(material: ResearchPostMaterial, parts: ResearchPostParts): string {
  const blocks: string[] = [];
  const quote = cleanText(material.quote);
  const comment = cleanText(material.comment);
  const sourceURL = safeSourceURL(material.sourceURL);

  if (parts.quote && quote) {
    blocks.push(escapeMarkdownText(quote).split("\n").map((line) => line ? `> ${line}` : ">").join("\n"));
  }
  if (parts.link && sourceURL) {
    const title = escapeMarkdownText(singleLine(material.title) || sourceTitle(sourceURL));
    const author = singleLine(material.author);
    blocks.push(`[${title}](${sourceURL})${author ? ` — ${escapeMarkdownText(author)}` : ""}`);
  }
  if (parts.comment && comment) {
    blocks.push(escapeMarkdownText(comment));
  }
  return blocks.join("\n\n");
}

export function appendResearchToDraft(draft: Draft, markdown: string): Draft {
  if (!markdown.trim()) return draft;
  const separator = !draft.markdown || draft.markdown.endsWith("\n\n")
    ? ""
    : draft.markdown.endsWith("\n") ? "\n" : "\n\n";
  const nextMarkdown = `${draft.markdown}${separator}${markdown}`;
  const document = importMarkdownDocument(nextMarkdown, { revision: (draft.blockRevision ?? 0) + 1 });
  return {
    ...draft,
    markdown: document.markdown,
    plaintext: markdownToPlaintext(document.markdown),
    blockDocumentJSON: JSON.stringify(document),
    blockSchemaVersion: document.schemaVersion,
    blockRevision: document.revision,
    updatedAt: new Date().toISOString(),
  };
}

function cleanText(value?: string) {
  return value?.replace(/\r\n?/g, "\n").trim() || undefined;
}

function singleLine(value?: string) {
  return cleanText(value)?.replace(/\s+/g, " ");
}

function sourceTitle(sourceURL?: string) {
  return sourceURL ? new URL(sourceURL).hostname.replace(/^www\./, "") : "Research note";
}

function safeSourceURL(value?: string): string | undefined {
  if (!value || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // Both the editor and publishing parser terminate destinations at a closing
    // parenthesis, so encode punctuation that could escape the generated link.
    return url.href.replace(/[()\[\]<>\\]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return undefined;
  }
}

function escapeMarkdownText(value: string) {
  return value.replace(/[\\`*_{}[\]()<>#+.!|~=-]/g, "\\$&");
}
