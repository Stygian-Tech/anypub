# pckt Standard.site indexing failure

## Summary

Documents published to a pckt publication through AnyPub are present in the author's PDS and have the expected final record graph, but pckt does not index or render them. Equivalent documents published through pckt's native editor are indexed successfully.

The publication-level bidirectional verification is valid. The most likely failure is a race caused by AnyPub writing the `site.standard.document` and its `blog.pckt.document` wrapper in two separate repository commits. pckt can observe the standard document before the wrapper exists—or before the wrapper references the document's new CID—and reject it without retrying after the wrapper arrives.

## Affected publication

```text
at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.publication/3mstwt6fh3frp
```

Publication URL:

```text
https://stygian-test.pckt.blog
```

## Observed behavior

- A document published through pckt's native editor is returned by pckt's `site.standard.getDocument` AppView endpoint and its public article URL renders successfully.
- A structurally equivalent document published through AnyPub exists in the PDS, along with its `blog.pckt.document` wrapper, but pckt's AppView returns `404` and the public article URL does not render.
- Comparing the records after publication does not expose a material shape difference that explains the indexing result.

Examples inspected during diagnosis:

| Source | Standard document | Path | pckt result |
| --- | --- | --- | --- |
| Native pckt | `at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.document/3msud52qe4ngk` | `/another-remote-test-psbyfky` | Indexed and rendered |
| AnyPub | `at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.document/3msucva67wm2w` | `/another-remote-test-d5ef09c` | AppView and page return `404` |

Earlier comparison records showed the same behavior:

- Native pckt: `at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.document/3msuahfkislci`
- AnyPub: `at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.document/3msuaazckj62f`

## Verification findings

### Publication-level verification passes

The `site.standard.publication` record points to:

```text
https://stygian-test.pckt.blog
```

The publication's verification endpoint returns the exact standard publication URI:

```text
GET https://stygian-test.pckt.blog/.well-known/site.standard.publication

at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.publication/3mstwt6fh3frp
```

The matching pckt publication record also exists:

```text
at://did:plc:zu7vdjfbiijes5rjcaaqtzke/blog.pckt.publication/3mstwt6fh3frp
```

Its strong reference points to the selected `site.standard.publication`, including the current publication CID.

This satisfies the publication's bidirectional relationship:

```text
site.standard.publication.url
    -> https://stygian-test.pckt.blog
    -> /.well-known/site.standard.publication
    -> original site.standard.publication AT URI

blog.pckt.publication.publication
    -> original site.standard.publication AT URI and CID
```

### Document and wrapper records are valid after publication

For the inspected AnyPub records:

- `site.standard.document.site` points to the exact standard publication URI.
- A `blog.pckt.document` record exists under the same repository and rkey.
- `blog.pckt.document.document.uri` points to the standard document.
- `blog.pckt.document.document.cid` matches the standard document's current CID.
- `blog.pckt.document.site` points to the pckt publication URI.

The final record graph is therefore valid once both writes have completed.

### Document URL verification cannot complete

A rendered native pckt article includes:

```html
<link
  rel="site.standard.document"
  href="at://did:plc:zu7vdjfbiijes5rjcaaqtzke/site.standard.document/3msuahfkislci"
/>
```

AnyPub's canonical URL is the pckt-hosted article URL. Because pckt never indexes the AnyPub document, it never renders that page or its `rel="site.standard.document"` verification link. This is downstream of the indexing failure and cannot be repaired solely by changing the document content envelope.

## Likely root cause: non-atomic related writes

AnyPub currently performs publication as two independent PDS operations:

1. Create or update `site.standard.document` with `com.atproto.repo.createRecord` or `com.atproto.repo.putRecord`.
2. Use the returned document URI and CID to write `blog.pckt.document` with another `com.atproto.repo.putRecord` request.

This creates a transiently invalid graph that an event-driven indexer can observe.

### New document sequence

```text
AnyPub                         PDS                         pckt indexer
  |                             |                              |
  | create standard document    |                              |
  |---------------------------->|                              |
  |                             | emit document event          |
  |                             |----------------------------->|
  |                             |                              | wrapper absent
  |                             |                              | verification fails
  | write pckt wrapper          |                              |
  |---------------------------->|                              |
  |                             | emit wrapper event           |
  |                             |----------------------------->|
  |                             |                              | document not retried
```

### Existing document update sequence

```text
AnyPub updates site.standard.document
    -> document receives a new CID
    -> existing blog.pckt.document temporarily references the old CID
    -> pckt observes and rejects the document event
    -> AnyPub updates the wrapper to the new CID
    -> pckt does not retry the rejected document
```

This explains why the records look correct when inspected later while AnyPub documents remain absent from the AppView.

The native pckt editor likely submits the related records atomically or has private ingestion coordination/retry behavior. This is an inference; pckt's publishing implementation was not available for inspection.

## Proposed implementation

### 1. Atomically write the standard document and pckt wrapper

For pckt publications, replace the two independent record calls with one `com.atproto.repo.applyWrites` request containing both writes.

Both records must:

- Use the same rkey.
- Be committed in one repository transaction.
- Use the exact standard publication and pckt publication URIs.
- Store a strong reference in `blog.pckt.document` containing the URI and CID of the document included in the same transaction.

Because the wrapper needs the document CID before the PDS processes the transaction, AnyPub will need deterministic local AT Protocol record encoding and CID generation for the `site.standard.document` record. The implementation must use canonical DAG-CBOR encoding and the CID format expected for repository records rather than hashing JSON text.

### 2. Apply the same transaction model to updates

An edit must atomically update both records so the wrapper never exposes a stale document CID.

Use swap conditions where appropriate to avoid overwriting concurrent changes:

- `swapRecord` for the prior document CID.
- `swapRecord` for the prior wrapper CID.
- `swapCommit` when the workflow has a known repository head and can safely retry a conflict.

### 3. Strengthen publication verification in AnyPub

AnyPub currently verifies only that a `blog.pckt.publication` record with the same rkey exists. Before publishing, it should also verify:

- The pckt publication's strong-reference URI equals the selected standard publication URI.
- Its strong-reference CID equals the current standard publication CID.
- The standard publication has a valid HTTPS URL.
- `/.well-known/site.standard.publication` on that URL returns the selected standard publication URI.

This hardening will reject mismatched or stale publication relationships with an actionable error. It does not, by itself, repair the current indexing failure because the inspected publication already passes these checks.

### 4. Handle records already missed by pckt

After atomic writes ship, publish a new test record first. Existing records may remain absent because their original document events were already rejected.

Possible recovery approaches:

- Atomically update/re-emit both records with a new document CID.
- Provide an explicit republish or repair action in AnyPub.
- Ask pckt to backfill/reindex the affected document URIs.

pckt should independently retry documents that fail relationship verification and reconsider a document when its `blog.pckt.document` wrapper is created or updated. That is an indexer-side resilience improvement and may require coordination with pckt maintainers.

## Acceptance criteria

- [ ] Creating a pckt-hosted document uses one `com.atproto.repo.applyWrites` transaction for `site.standard.document` and `blog.pckt.document`.
- [ ] Updating a pckt-hosted document updates both records in one transaction.
- [ ] Both records use the same rkey.
- [ ] The wrapper's strong-reference CID matches the exact document record committed in the transaction.
- [ ] Publication verification validates the pckt strong reference, its CID, and the Standard.site well-known response.
- [ ] Verification failures produce actionable errors and do not leave an orphaned standard document or stale wrapper.
- [ ] Unit tests cover create and update payloads, deterministic record CIDs, stale publication references, mismatched well-known responses, and transaction conflicts.
- [ ] Integration tests prove there is no observable repository commit containing only one side of the pckt document relationship.
- [ ] A newly published AnyPub article is returned by pckt's `site.standard.getDocument` endpoint.
- [ ] The pckt article URL renders and contains the correct `rel="site.standard.document"` link.
- [ ] Editing an indexed AnyPub article preserves its pckt visibility and updates the wrapper CID.
- [ ] A recovery path is verified for AnyPub records that pckt previously failed to index.

## Relevant AnyPub code

- `services/backend/Sources/App/Services/PublisherService.swift`
  - Writes the standard document before calling `createPlatformDocument`.
  - Creates the pckt wrapper from the document response in a second request.
  - `verifiedPcktPublicationURI` currently checks only record existence.
- `services/backend/Sources/App/Services/ATProtoXRPCClient.swift`
  - Implements individual `com.atproto.repo.createRecord` and `com.atproto.repo.putRecord` operations.
  - Does not currently implement `com.atproto.repo.applyWrites`.

## References

- [Standard.site verification](https://standard.site/docs/verification/)
- [Indexing Standard.site records](https://atproto.com/blog/indexing-standard-site)
- [`com.atproto.repo.applyWrites` lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/applyWrites.json)

