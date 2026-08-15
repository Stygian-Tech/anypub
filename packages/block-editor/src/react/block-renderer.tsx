"use client";

import * as React from "react";
import { SquareCheckIcon, SquareIcon } from "lucide-react";
import { orderedListOrdinalAt, type BlockDocument, type MarkdownBlock } from "../model/index.js";
import { cn } from "../utils.js";
import { SyntaxHighlightedCode } from "./syntax-highlighted-code.js";

export type ImageURLResolver = (url: string) => string | undefined;

export function BlockDocumentRenderer({
  document,
  className,
  resolveImageURL,
}: {
  document: BlockDocument;
  className?: string;
  resolveImageURL?: ImageURLResolver;
}) {
  return (
    <div className={cn("typeset typeset-block-editor", className)}>
      {document.blocks.map((block, index) => (
        <MarkdownBlockPreview
          key={block.id}
          block={block}
          orderedListOrdinal={block.kind === "ordered-list" ? orderedListOrdinalAt(document.blocks, index) : undefined}
          onToggleTask={() => undefined}
          resolveImageURL={resolveImageURL}
        />
      ))}
    </div>
  );
}

export function MarkdownBlockPreview({
  block,
  orderedListOrdinal,
  onToggleTask,
  resolveImageURL,
}: {
  block: MarkdownBlock;
  orderedListOrdinal?: number;
  onToggleTask?: (itemIndex: number) => void;
  resolveImageURL?: ImageURLResolver;
}) {
  const trimmed = block.source.trim();

  if (block.kind === "empty") {
    return <span className="text-muted-foreground text-base leading-7">Empty block</span>;
  }

  if (block.kind === "code") {
    const code = trimmed.replace(/^```[^\n`]*\n?/, "").replace(/\n?```$/, "");
    return <SyntaxHighlightedCode code={code} language={block.language} />;
  }

  if (block.kind === "image") {
    const src = resolveImageURL?.(block.url) ?? safeImageURL(block.url);
    return src ? (
      <figure className="overflow-hidden rounded-md border bg-muted/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={block.alt} className="max-h-[34rem] w-full object-contain" />
        {block.alt ? <figcaption className="text-muted-foreground px-3 py-2 text-xs">{block.alt}</figcaption> : null}
      </figure>
    ) : <span className="text-muted-foreground italic">Image: {block.alt || block.url}</span>;
  }

  if (block.kind === "embed") {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-3">
        <span className="text-muted-foreground block text-xs font-medium uppercase tracking-wide">Embedded link</span>
        <a href={block.url} className="mt-1 block truncate underline underline-offset-2" onClick={(event) => event.preventDefault()}>
          {block.url}
        </a>
      </div>
    );
  }

  if (block.kind === "heading") {
    const text = trimmed.replace(/^#{1,6}\s+/, "");
    const level = block.headingLevel;
    if (level === 1) {
      return <h1 className="text-2xl font-semibold leading-tight">{renderMarkdownLines(text.split("\n"))}</h1>;
    }
    if (level === 2) {
      return <h2 className="text-xl font-semibold leading-tight">{renderMarkdownLines(text.split("\n"))}</h2>;
    }
    if (level === 3) {
      return <h3 className="text-lg font-semibold leading-tight">{renderMarkdownLines(text.split("\n"))}</h3>;
    }
    return <h4 className="text-base font-semibold leading-tight">{renderMarkdownLines(text.split("\n"))}</h4>;
  }

  if (block.kind === "thematic-break") {
    return <hr data-testid="markdown-thematic-break" className="my-3 border-t border-border" />;
  }

  if (block.kind === "quote") {
    return (
      <blockquote className="text-muted-foreground border-l-2 pl-3 text-base leading-7">
        {renderMarkdownLines(trimmed.split("\n").map((line) => line.replace(/^\s{0,3}>\s?/, "")))}
      </blockquote>
    );
  }

  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    const item = block.source
      .trimEnd()
      .split("\n")
      .map((line, index) => index === 0 ? line.replace(/^[ \t]*(?:[-*+]\s*|\d+\.\s*)/, "") : line)
      .join("\n");

    if (block.kind === "ordered-list") {
      return (
        <ol className="list-inside text-base leading-7" start={orderedListOrdinal ?? block.listStart} style={{ listStyleType: orderedListStyleForLevel(block.listLevel) }}>
          <li>{renderMarkdownLines(item.split("\n"))}</li>
        </ol>
      );
    }

    const task = item.match(/^\[([ xX])\]\s*([\s\S]*)$/);
    return (
      <ul className="list-none text-base leading-7">
        <li className="flex items-start gap-2.5">
              {task ? (
                <span
                  role="checkbox"
                  aria-checked={task[1] !== " "}
                  aria-label={task[2] || "Task item"}
                  data-testid="markdown-task-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleTask?.(0);
                  }}
                  className="hover:text-foreground flex h-7 shrink-0 cursor-pointer items-center"
                >
                  {task[1] === " " ? (
                    <SquareIcon data-testid="markdown-task-marker" className="text-muted-foreground size-4.5 transition-colors hover:text-current" />
                  ) : (
                    <SquareCheckIcon data-testid="markdown-task-marker" data-checked="true" className="size-4.5" />
                  )}
                </span>
              ) : (
                <span aria-hidden="true" className="flex h-7 w-2.5 shrink-0 items-center justify-center">
                  <span
                    data-testid="markdown-list-marker"
                    className={unorderedListMarkerClass(block.listLevel)}
                    style={block.listLevel > 0 && block.listLevel % 2 === 1 ? { borderColor: "currentColor" } : undefined}
                  />
                </span>
              )}
              <span className="min-w-0 flex-1">{renderMarkdownLines((task ? task[2] ?? "" : item).split("\n"))}</span>
        </li>
      </ul>
    );
  }

  return <p className="text-base leading-7">{renderMarkdownLines(trimmed.split("\n"))}</p>;
}

export function MarkdownListEditingMarker({
  block,
  orderedListOrdinal,
}: {
  block: Extract<MarkdownBlock, { kind: "unordered-list" | "ordered-list" }>;
  orderedListOrdinal?: number;
}) {
  if (block.kind === "ordered-list") {
    return (
      <span
        aria-hidden="true"
        data-testid="markdown-editing-list-marker"
        className="h-7 shrink-0 text-base leading-7 tabular-nums"
      >
        {orderedListMarkerLabel(orderedListOrdinal ?? block.listStart, block.listLevel)}
      </span>
    );
  }

  return (
    <span aria-hidden="true" className="flex h-7 w-2.5 shrink-0 items-center justify-center">
      <span
        data-testid="markdown-editing-list-marker"
        className={unorderedListMarkerClass(block.listLevel)}
        style={block.listLevel > 0 && block.listLevel % 2 === 1 ? { borderColor: "currentColor" } : undefined}
      />
    </span>
  );
}

function orderedListMarkerLabel(ordinal: number, level: number) {
  return level % 2 === 0 ? `${ordinal}.` : `${alphabeticOrdinal(ordinal)}.`;
}

function alphabeticOrdinal(ordinal: number) {
  let value = Math.max(1, ordinal);
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(97 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function orderedListStyleForLevel(level: number) {
  return level % 2 === 0 ? "decimal" : "lower-alpha";
}

function unorderedListMarkerClass(level: number) {
  if (level === 0) {
    return "size-1.5 rounded-full bg-current";
  }

  if (level % 2 === 0) {
    return "size-1.5 bg-current";
  }

  return "text-foreground size-2 shrink-0 rounded-full border-[1.5px] border-current opacity-100";
}

function renderMarkdownLines(lines: string[]) {
  return lines.map((line, index) => (
    <React.Fragment key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInlineMarkdown(line)}
    </React.Fragment>
  ));
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(!?\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\+\+[^+]+\+\+|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    nodes.push(renderInlineToken(token, nodes.length));
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : text;
}

function renderInlineToken(token: string, key: number) {
  const image = token.match(/^!\[([^\]]+)\]\(([^)]+)\)$/);
  if (image) {
    return <span key={key} className="text-muted-foreground italic">{image[1]}</span>;
  }

  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const href = safeMarkdownHref(link[2] ?? "");
    if (!href) {
      return <span key={key}>{link[1]}</span>;
    }
    return (
      <a key={key} href={href} className="underline underline-offset-2" onClick={(event) => event.preventDefault()}>
        {link[1]}
      </a>
    );
  }

  if (token.startsWith("`")) {
    return <code key={key} className="bg-muted rounded px-1 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>;
  }

  if (token.startsWith("**")) {
    return <strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>;
  }

  if (token.startsWith("__")) {
    return <strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>;
  }

  if (token.startsWith("~~")) {
    return <del key={key} className="line-through">{token.slice(2, -2)}</del>;
  }

  if (token.startsWith("++")) {
    return <u key={key} className="underline underline-offset-2">{token.slice(2, -2)}</u>;
  }

  return <em key={key} className="italic">{token.slice(1, -1)}</em>;
}

function safeMarkdownHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|at:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function safeImageURL(url: string) {
  const trimmed = url.trim();
  return /^(https?:|blob:|data:image\/)/i.test(trimmed) ? trimmed : undefined;
}
