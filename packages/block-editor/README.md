# `@stygian/markdown-editor`

A reusable React block editor whose canonical value is Markdown. It provides a
controlled Markdown editor, a revisioned block-document model, read-only block
rendering, drag-and-drop ordering, nested lists and tasks, fenced-code syntax
highlighting, image-drop hooks, and pluggable custom image URL resolution.

The package does not upload files or prescribe an asset backend. Consumers own
those integrations and insert whichever Markdown image URL scheme they use.

## Install

```bash
bun add @stygian/markdown-editor
```

React 19, React DOM 19, and Tailwind CSS 4 are peer dependencies. Import the
package stylesheet once in the consuming app's global CSS:

```css
@import "tailwindcss";
@import "@stygian/markdown-editor/styles";
```

The stylesheet contains a Tailwind `@source` directive for the compiled package,
so consumers do not need a repository-relative source path.

## Controlled Markdown editor

```tsx
import { MarkdownBlockEditor } from "@stygian/markdown-editor";

export function ArticleEditor() {
  const [markdown, setMarkdown] = useState("# Hello");

  return (
    <MarkdownBlockEditor
      value={markdown}
      onChange={setMarkdown}
    />
  );
}
```

## Custom asset storage

Use `onImageFiles` to upload dropped or pasted images, then insert the returned
reference through the editor handle. Use `resolveImageURL` to turn that stored
Markdown URL into a browser-safe preview URL.

```tsx
const editorRef = useRef<BlockEditorHandle>(null);

<MarkdownBlockEditor
  ref={editorRef}
  value={markdown}
  onChange={setMarkdown}
  onImageFiles={async (files, insertionIndex) => {
    const asset = await upload(files[0]);
    editorRef.current?.insertBlock(
      `![${asset.alt}](my-app-asset://${asset.id})`,
      insertionIndex,
    );
  }}
  resolveImageURL={(url) => {
    const id = assetIDFromURL(url);
    return id ? `/api/assets/${encodeURIComponent(id)}` : undefined;
  }}
/>
```

Standard `http`, `https`, `blob`, and image `data:` URLs render without a custom
resolver. Unsafe or unknown schemes render as text unless the consumer resolves
them explicitly.

## Revisioned documents

`BlockEditor` accepts a `BlockDocument` for consumers that persist stable block
IDs and compare-and-swap revisions. `importMarkdownDocument`,
`parseBlockDocument`, and `reviseBlockDocument` are also exported from the main
entry point and from `@stygian/markdown-editor/model`. Block metadata is derived
from each block's Markdown `source` and normalized when a snapshot is parsed, so
older schema-v1 snapshots continue to load as parser details evolve.

## Publishing

`bun run build` emits ESM JavaScript, source maps, and declarations to `dist`.
`bun pm pack --dry-run` can be used to inspect the registry artifact before a
release. Publishing is intentionally separate from consuming the workspace
package in AnyPub.
