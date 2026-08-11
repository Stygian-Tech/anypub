import type { CalendarItem, Draft, LinkedAccount, Publication } from "@/lib/types";

export const seedAccounts: LinkedAccount[] = [
  {
    id: "acct-1",
    did: "did:plc:writer",
    handle: "writer.standard.site",
    displayName: "Sam Standard",
    avatarURL: "",
    pdsURL: "https://bsky.social",
    scope:
      "atproto transition:generic include:site.standard.authFull include:app.offprint.authFull include:blog.pckt.authFull include:community.lexicon.calendar.authFull",
    linkedAt: "2026-07-08T15:00:00.000Z",
    updatedAt: "2026-07-08T15:00:00.000Z",
  },
  {
    id: "acct-2",
    did: "did:plc:editor",
    handle: "editor.example.com",
    displayName: "Editorial Desk",
    avatarURL: "",
    pdsURL: "https://example-pds.test",
    scope:
      "atproto transition:generic include:site.standard.authFull include:app.offprint.authFull include:blog.pckt.authFull include:community.lexicon.calendar.authFull",
    linkedAt: "2026-07-07T15:00:00.000Z",
    updatedAt: "2026-07-07T15:00:00.000Z",
  },
];

export const seedPublications: Publication[] = [
  {
    id: "pub-1",
    accountDID: "did:plc:writer",
    uri: "at://did:plc:writer/site.standard.publication/3lxyz",
    cid: "bafyreibasic",
    name: "Standard Notes",
    url: "https://standard.example.com",
    description: "Release notes and essays for a standard.site publication.",
    themeType: "pub.leaflet.publication#theme",
    themeName: "Leaflet editorial",
    host: "leaflet",
    syncedAt: "2026-07-08T16:00:00.000Z",
  },
  {
    id: "pub-2",
    accountDID: "did:plc:writer",
    uri: "at://did:plc:writer/site.standard.publication/3labc",
    cid: "bafyreibasic2",
    name: "Field Guide",
    url: "https://field.example.com",
    description: "Operational notes across deployment targets.",
    themeType: "app.offprint.theme",
    themeName: "Offprint journal",
    host: "offprint",
    syncedAt: "2026-07-08T16:00:00.000Z",
  },
  {
    id: "pub-3",
    accountDID: "did:plc:editor",
    uri: "at://did:plc:editor/site.standard.publication/3lqrs",
    cid: "bafyreibasic3",
    name: "Editorial Desk",
    url: "https://desk.example.com",
    description: "Drafts and publishing calendar for an editorial team.",
    themeType: "blog.pckt.theme",
    themeName: "pckt desk",
    host: "pckt",
    syncedAt: "2026-07-08T16:00:00.000Z",
  },
];

export const seedDrafts: Draft[] = [
  {
    id: "draft-1",
    accountDID: "did:plc:writer",
    publicationURI: "at://did:plc:writer/site.standard.publication/3lxyz",
    publicationURL: "https://standard.example.com",
    title: "Shipping the first AnyPub CMS pass",
    path: "/shipping-anypub",
    excerpt: "A compact update on the CMS workflow for standard.site publications.",
    tags: ["release", "cms"],
    markdown:
      "# Shipping the first AnyPub CMS pass\n\n## Editorial surface\n\n### Block coverage\n\n#### Nested list contract\n\nThe first version focuses on OAuth-linked accounts, existing publications, local drafts, and standard.site document publishing.\n\n- Multiple linked accounts\n\t- Account-scoped publication cache\n\t\t- Publication host derived from theme lexicons\n\t\t\t- Leaflet, Offprint, and pckt compatibility paths\n- Publication-scoped drafting\n\t- Markdown blocks stay individually addressable\n- Calendar-aware scheduling\n\n- [ ] Upload a cover image\n- [x] Preserve alt text and captions in draft metadata\n\t- [ ] Map checklist state into target host blocks\n\n1. Draft locally\n\t1. Choose a publication\n\t\t1. Resolve host adapter\n2. Schedule or publish\n\t1. Create calendar event linkage\n\t\t1. Store update pointer for retries\n\n---\n\n<div data-callout=\"editor-note\">HTML div blocks should remain intact until the host adapter translates them.</div>\n\n> Scheduled and published articles should show up in the unified calendar.\n> Calendar events keep the article URL and AT URI together.",
    plaintext:
      "Shipping the first AnyPub CMS pass\nEditorial surface\nBlock coverage\nNested list contract\nThe first version focuses on OAuth-linked accounts, existing publications, local drafts, and standard.site document publishing.\nMultiple linked accounts\nAccount-scoped publication cache\nPublication host derived from theme lexicons\nLeaflet, Offprint, and pckt compatibility paths\nPublication-scoped drafting\nMarkdown blocks stay individually addressable\nCalendar-aware scheduling\nUpload a cover image\nPreserve alt text and captions in draft metadata\nMap checklist state into target host blocks\nDraft locally\nChoose a publication\nResolve host adapter\nSchedule or publish\nCreate calendar event linkage\nStore update pointer for retries\nHTML div blocks should remain intact until the host adapter translates them.\nScheduled and published articles should show up in the unified calendar.\nCalendar events keep the article URL and AT URI together.",
    status: "scheduled",
    scheduledAt: "2026-07-14T15:00:00.000Z",
    createdAt: "2026-07-08T16:00:00.000Z",
    updatedAt: "2026-07-08T18:30:00.000Z",
  },
  {
    id: "draft-2",
    accountDID: "did:plc:writer",
    publicationURI: "at://did:plc:writer/site.standard.publication/3labc",
    publicationURL: "https://field.example.com",
    title: "Deployment notes for Leaflet and Pckt",
    path: "/leaflet-pckt-notes",
    excerpt: "Compatibility notes while structured block publishing remains deferred.",
    tags: ["compatibility"],
    markdown:
      "## Deployment notes\n\nInline images and block output stay out of v1. Cover images publish through `coverImage` blobs.",
    plaintext:
      "Deployment notes\nInline images and block output stay out of v1. Cover images publish through coverImage blobs.",
    status: "draft",
    createdAt: "2026-07-08T17:00:00.000Z",
    updatedAt: "2026-07-08T17:10:00.000Z",
  },
  {
    id: "draft-3",
    accountDID: "did:plc:writer",
    publicationURI: "at://did:plc:writer/site.standard.publication/3labc",
    publicationURL: "https://field.example.com",
    title: "Published calendar event smoke test",
    path: "/published-calendar-smoke-test",
    excerpt: "A published document that already has a calendar event link.",
    tags: ["calendar"],
    markdown: "Published content used to verify the unified calendar.",
    plaintext: "Published content used to verify the unified calendar.",
    status: "published",
    publishedAt: "2026-07-06T13:00:00.000Z",
    documentURI: "at://did:plc:writer/site.standard.document/3l999",
    documentCID: "bafyrecord",
    createdAt: "2026-07-03T17:00:00.000Z",
    updatedAt: "2026-07-06T13:05:00.000Z",
  },
];

export function draftActivityDate(draft: Draft) {
  return draft.publishedAt ?? draft.scheduledAt ?? draft.updatedAt;
}

export function sortDraftsReverseChronological(drafts: Draft[]) {
  return [...drafts].sort(
    (left, right) => Date.parse(draftActivityDate(right)) - Date.parse(draftActivityDate(left)),
  );
}

export function calendarItemsFromDrafts(drafts: Draft[]): CalendarItem[] {
  return drafts
    .filter((draft) => draft.status === "scheduled" || draft.status === "published")
    .map((draft) => ({
      draftID: draft.id,
      title: draft.title,
      status: draft.status,
      date: draft.publishedAt ?? draft.scheduledAt,
      publicationURI: draft.publicationURI,
      documentURI: draft.documentURI,
    }))
    .sort((left, right) => (left.date ?? "").localeCompare(right.date ?? ""));
}
