# Provenance in AIR

AIR distinguishes three separate provenance questions, and answers each one
explicitly rather than collapsing them into a single "verified" flag.

## 1. How was this conversation acquired? (Capture Provenance Class)

Recorded in `air.json`'s `capture.class`, one of `AIR-C0`–`AIR-C4` (see
`docs/AIR-0.1.md`). This is about **acquisition method**, not about whether
the conversation content is trustworthy — a pasted transcript (`AIR-C0`) may
be perfectly accurate; it is simply the weakest *evidence trail* for how
`chat2archive` obtained it.

`chat2archive` sets this automatically based on which importer ran:

- official provider export (ZIP/JSON) → `AIR-C2`
- pasted transcript → `AIR-C0`
- a fetched public ChatGPT or Claude share page → `AIR-C1` (web UI, via the Cloudflare Worker in `src/worker/`)
- an authenticated API response → `AIR-C3` (not implemented; no provider
  authentication is performed by this tool)

## 2. Where does a specific fact come from? (Evidence)

Recorded per-field, most importantly on model identity:

```yaml
evidence: api_response | provider_export | displayed_in_ui | share_page | user_reported | inferred | unknown
```

`chat2archive`'s importers currently do not attempt to infer a model name
from export metadata that doesn't explicitly state it (e.g. ChatGPT's
`model_slug` field is provider-internal and unstable, so v0.1 leaves
`model.name` `null` with `evidence: "unknown"` rather than guess). This is a
deliberate v0.1 limitation, not an oversight — inventing a display name from
an internal slug would be exactly the kind of silent inference this project
exists to avoid.

## 3. What relationship does this record have to other records?

Recorded in `air.json`'s `related` array and mirrored into
`ro-crate-metadata.json` / `datacite.json`: `continuedFrom`, `isVersionOf`,
`hasVersion`, `isDerivedFrom`, `isSourceOf`, `relatedPublication`.

`chat2archive` never mutates a previously generated archive. A continued
conversation is a new archive with a `continuedFrom` relationship, set via
`chat2archive INPUT --related-doi <doi-of-previous-record>` (mapped to
`relatedPublication`) or by editing `air.json`'s `related` array by hand
before re-packaging.

## What AIR explicitly does not attest to

Regardless of capture class or evidence tags, no AIR record can attest to:

- hidden system prompts, provider-side routing, or safety classifiers;
- model weights or exact inference configuration (sampling seed, etc.);
- undisclosed tool calls or preprocessing the provider performed silently;
- that the *content* of a message was not itself edited by the provider's
  own systems before being surfaced.

This is stated in every generated `INTERACTION.md`'s "Limitations" section.
