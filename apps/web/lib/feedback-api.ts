import { apiFetch } from "@/lib/api";

export type FeedbackTag = {
  label: string;
  value: string;
};

export type FeedbackBoard = {
  name: string;
  uri: string;
  tags: FeedbackTag[];
  publicURL: string;
};

export type FeedbackSubmission = {
  uri: string;
  cid: string;
  url: string;
};

export function loadFeedbackBoard(signal?: AbortSignal) {
  return apiFetch<FeedbackBoard>("/api/feedback/board", { signal });
}

export function submitFeedback(input: {
  title: string;
  body?: string;
  tags: string[];
  assetIDs: string[];
}) {
  return apiFetch<FeedbackSubmission>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function hasFeedbackPermission(scope: string) {
  return scope.split(/\s+/).some((value) => {
    const [base, query = ""] = value.split("?");
    if (base === "include:app.userinput.authFull") return true;
    const params = new URLSearchParams(query);
    const allowsCollection = base === "repo:app.userinput.discussion"
      || base === "repo:*"
      || (base === "repo" && params.getAll("collection").some((item) => item === "app.userinput.discussion" || item === "*"));
    const actions = params.getAll("action");
    return allowsCollection && (actions.length === 0 || actions.includes("create"));
  });
}
