import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("block editor style integration", () => {
  it("imports the package stylesheet and includes its Tailwind utility sources", () => {
    expect(globalStyles).toContain('@import "@anypub/block-editor/styles";');
    expect(globalStyles).toContain('@source "../../../packages/block-editor/src";');
  });
});
