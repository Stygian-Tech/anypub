import { apiFetch } from "./api";
import type { LinkedAccount } from "./types";

export type OAuthStartResponse = {
  state: string;
  scopes: string;
  authorizationURL: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

export function loadAccounts(signal?: AbortSignal) {
  return apiFetch<LinkedAccount[]>("/api/accounts", { signal });
}

export function unlinkAccount(did: string) {
  return apiFetch<void>(`/api/accounts/${encodeURIComponent(did)}`, {
    method: "DELETE",
  });
}

export function startOAuth(handle: string, redirectURL: string) {
  return apiFetch<OAuthStartResponse>("/api/auth/atproto/start", {
    method: "POST",
    body: JSON.stringify({ handle, redirectURL }),
  });
}
