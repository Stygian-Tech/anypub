export type LinkedAccount = {
  id?: string;
  did: string;
  handle: string;
  displayName?: string;
  avatarURL?: string;
  pdsURL: string;
  scope: string;
  linkedAt: string;
  updatedAt: string;
};

export type Publication = {
  id: string;
  accountDID: string;
  uri: string;
  cid?: string;
  name: string;
  url: string;
  description?: string;
  themeType?: string;
  themeName?: string;
  host?: "leaflet" | "offprint" | "pckt";
  syncedAt: string;
};

export type DraftStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export type Draft = {
  id: string;
  accountDID: string;
  publicationURI: string;
  publicationURL: string;
  title: string;
  path?: string;
  excerpt?: string;
  tags: string[];
  markdown: string;
  plaintext: string;
  blockDocumentJSON?: string;
  blockSchemaVersion?: number;
  blockRevision?: number;
  coverAssetID?: string;
  status: DraftStatus;
  scheduledAt?: string;
  publishedAt?: string;
  documentURI?: string;
  documentCID?: string;
  platformDocumentURI?: string;
  platformDocumentCID?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalendarItem = {
  draftID: string;
  title: string;
  status: DraftStatus;
  date?: string;
  publicationURI: string;
  documentURI?: string;
};
