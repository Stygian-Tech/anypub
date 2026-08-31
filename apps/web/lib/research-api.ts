import { apiFetch } from "@/lib/api";

export type SembleResearchCard = {
  uri: string;
  url?: string;
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  note?: string;
  createdAt?: string;
};

export type SembleResearchCollection = {
  uri: string;
  name: string;
  description?: string;
  accessType: string;
  createdAt?: string;
  updatedAt?: string;
  cards: SembleResearchCard[];
};

export type MarginResearchAnnotation = {
  uri: string;
  motivation: string;
  source: string;
  title?: string;
  body?: string;
  quote?: string;
  tags: string[];
  color?: string;
  createdAt: string;
  modifiedAt?: string;
};

export type ResearchResponse = {
  semble: {
    collections: SembleResearchCollection[];
    error?: string;
  };
  margin: {
    annotations: MarginResearchAnnotation[];
    error?: string;
  };
};

export function loadResearch(signal?: AbortSignal) {
  return apiFetch<ResearchResponse>("/api/research", { signal });
}
