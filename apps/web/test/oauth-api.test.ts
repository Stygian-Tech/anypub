import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccounts, startOAuth } from "@/lib/oauth-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OAuth API", () => {
  it("loads linked accounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await loadAccounts();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/accounts",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("starts OAuth with a safe browser return URL", async () => {
    const payload = {
      state: "state",
      scopes: "atproto",
      authorizationURL: "https://auth.example/authorize?request_uri=urn:test",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await startOAuth("writer.example.com", "http://localhost:3000/");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/auth/atproto/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          handle: "writer.example.com",
          redirectURL: "http://localhost:3000/",
        }),
      }),
    );
  });
});
