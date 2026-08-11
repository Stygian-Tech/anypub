import { describe, expect, it } from "vitest";
import { localDevOrigins } from "@/lib/development";

describe("Next.js development config", () => {
  it("allows the loopback preview origin used by local browser tooling", () => {
    expect(localDevOrigins).toContain("127.0.0.1");
  });
});
