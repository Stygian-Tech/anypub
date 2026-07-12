import type { Draft } from "@/lib/types";

export type DraftValidationResult = {
  valid: boolean;
  errors: Record<string, string>;
};

export function validateDraft(draft: Pick<Draft, "title" | "publicationURI" | "markdown" | "path">): DraftValidationResult {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) {
    errors.title = "Title is required.";
  }
  if (!draft.publicationURI.trim()) {
    errors.publicationURI = "Publication is required.";
  }
  if (!draft.markdown.trim()) {
    errors.markdown = "Markdown body is required.";
  }
  if (draft.path && !draft.path.startsWith("/")) {
    errors.path = "Path must start with /.";
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function markdownToPlaintext(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, "\n")
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[~*_]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
