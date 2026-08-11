import { describe, expect, it } from "vitest";
import { getWebPublicURL } from "@/lib/public-url";

function headers(values: Record<string, string>): Pick<Headers, "get"> {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

describe("getWebPublicURL", () => {
  it("uses Railway's public domain when deployed", () => {
    const url = getWebPublicURL({ RAILWAY_PUBLIC_DOMAIN: "testing.anypub.at" });
    expect(url.href).toBe("https://testing.anypub.at/");
  });

  it("uses an explicitly configured public web origin outside Railway", () => {
    const url = getWebPublicURL({ WEB_PUBLIC_URL: "https://preview.anypub.at" });
    expect(url.href).toBe("https://preview.anypub.at/");
  });

  it("falls back to trusted proxy headers for preview environments", () => {
    const url = getWebPublicURL(
      {},
      headers({
        "x-forwarded-host": "branch.example.dev",
        "x-forwarded-proto": "https",
      }),
    );
    expect(url.href).toBe("https://branch.example.dev/");
  });

  it("rejects malformed origins instead of reflecting them into metadata", () => {
    const url = getWebPublicURL(
      { RAILWAY_PUBLIC_DOMAIN: "https://testing.anypub.at/path" },
      headers({ host: "bad.example/path" }),
    );
    expect(url.href).toBe("http://localhost:3000/");
  });
});
