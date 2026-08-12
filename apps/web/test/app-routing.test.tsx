import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { LoginPage } from "@/components/login-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

beforeEach(() => {
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("application routes", () => {
  it("renders a public homepage with separate login and editor entry points", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: /Publish to the open social web/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continue with AT Protocol/ })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /Open editor/ })).toHaveAttribute("href", "/editor");
  });

  it("redirects an authenticated login visit to the editor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{
      did: "did:plc:writer",
      handle: "writer.example",
      pdsURL: "https://pds.example",
      scope: "atproto",
      linkedAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    }])));

    render(<LoginPage />);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/editor"));
    expect(screen.queryByRole("textbox", { name: "Handle" })).not.toBeInTheDocument();
  });

  it("starts OAuth from login with the editor as its validated return route", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/accounts")) {
        return Response.json({ error: true, reason: "Sign in to continue" }, { status: 401 });
      }
      return Response.json({
        state: "state",
        scopes: "atproto",
        authorizationURL: "https://auth.example/authorize",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAuthorize = vi.fn();

    render(<LoginPage onAuthorize={onAuthorize} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Handle" }), {
      target: { value: "writer.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with AT Protocol" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/auth/atproto/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          handle: "writer.example",
          redirectURL: "http://localhost:3000/editor",
        }),
      }),
    ));
    expect(onAuthorize).toHaveBeenCalledWith("https://auth.example/authorize");
  });
});
