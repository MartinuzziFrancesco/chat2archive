# AIR 0.1 — AI Interaction Record

AIR (AI Interaction Record) is a protocol for representing a single observed
AI conversation as a provider-neutral, citable research object. It is an
**RO-Crate profile**: an AIR package is a valid [RO-Crate](https://www.researchobject.org/ro-crate/)
with additional normative structure specific to AI conversations.

This document describes protocol version **0.1**. `chat2archive` is the
reference implementation.

## Design principle

Adapted from *Datasheets for Datasets* (Gebru et al., 2018):

> Preserve what was observed; document how it was obtained; identify what is
> unknown; never infer provenance silently.

AIR represents an **observable interaction**, not a claim to reproduce a
provider's internal inference execution. It cannot and does not claim to
capture hidden system prompts, provider-side routing, model weights, safety
classifiers, inference seeds, or undisclosed preprocessing.

## Package structure

```
air-record/
├── README.md              convenience
├── INTERACTION.md          convenience — interaction datasheet
├── conversation.jsonl      NORMATIVE — the event log
├── transcript.md           convenience — human-readable rendering
├── transcript.html         convenience — human-readable rendering, offline-readable
├── attachments/            convenience — referenced attachment files, when captured
├── ro-crate-metadata.json  NORMATIVE — RO-Crate / JSON-LD package description
├── datacite.json           convenience — suggested DataCite deposit metadata
├── zenodo.json             convenience — suggested Zenodo deposit metadata
├── air.json                NORMATIVE — record metadata (schema/air-0.1.schema.json)
└── SHA256SUMS              NORMATIVE — integrity hashes for every file above
```

Normative files must be present and internally consistent for a package to
be a valid AIR 0.1 record; convenience files are generated renderings and
may be regenerated from the normative files without loss.

## `conversation.jsonl`

The canonical, authoritative record of the interaction: one JSON object per
line, each a graph node with a stable `id` and, for non-root events, a
`parent` reference to another event's `id`. This is a **graph, not a flat
array** — branches, regenerations, and retries are represented as multiple
events sharing a parent, not flattened or silently collapsed.

Every event has at minimum:

```json
{ "id": "event-001", "type": "message" }
```

### Event types (v0.1)

| Type | Purpose |
|---|---|
| `message` | A turn from a `user`, `assistant`, `system`, or `tool` role |
| `tool_call` | A tool/function invocation, when exposed by the source |
| `tool_result` | The result of a tool call, when exposed by the source |
| `attachment` | A file supplied to the conversation |
| `generated_file` | A file produced during the conversation |
| `citation` | A citation/reference surfaced during the conversation |
| `edit` | Marks that an event is an edited version of another |
| `regeneration` | Marks that an event is a regenerated version of another |
| `branch` | An explicit branch marker, when the source exposes one |
| `system_event` | A source-specific event that doesn't fit the above |

Event types are extensible; unrecognized types must be preserved, not
dropped, by conforming tooling.

A source that exposes only a flat sequence must be represented as a flat
parent chain — AIR must never invent branch structure that the source did
not expose.

## Model and system metadata: evidence, not assertion

Every claim about model identity or execution configuration is tagged with
where it came from:

```yaml
model:
  name: "Claude Sonnet 4.5"
  provider: "Anthropic"
  evidence: displayed_in_ui   # api_response | provider_export | displayed_in_ui
                                # | share_page | user_reported | inferred | unknown
```

An inferred model name must never be silently presented as an observed fact.

## Capture provenance

Every record declares **how it entered chat2archive**:

| Class | Source | Interpretation |
|---|---|---|
| `AIR-C0` | pasted transcript | user-supplied text; weakest provenance |
| `AIR-C1` | public share URL captured by tool | tool observed a publicly accessible page |
| `AIR-C2` | official provider export | came from an official account export |
| `AIR-C3` | authenticated API/provider record | obtained from an authenticated response |
| `AIR-C4` | cryptographically/provider-signed record | reserved for future use |

Capture provenance classes describe evidence about *acquisition*, not
truthfulness of the conversation content.

## Canonicalization and integrity

The canonical byte representation of the event log is: each event
JSON-serialized with **object keys sorted lexicographically** (array order
is preserved — it is semantically significant), one per line, LF-terminated,
UTF-8 encoded, joined with no other whitespace. This is exactly the byte
content of `conversation.jsonl`.

`air.json`'s `canonical_sha256` is the SHA-256 of that exact byte sequence.
Every file in the package, including `air.json` and `ro-crate-metadata.json`
themselves, is additionally hashed in `SHA256SUMS`.

A hash proves only that the archived bytes have not changed since hashing.
It does not prove the source conversation was authentic, complete, or
unaltered by the provider before capture.

See `src/core/hash.ts` for the reference implementation and
`tests/hash.test.ts` / `tests/package.test.ts` for the fixtures that pin
this behavior.

## `air.json`

Record-level metadata, validated against `schema/air-0.1.schema.json`. See
that file for the normative field list; §12 of the project's design document
describes the intent behind each field.

## Relationships between records

AIR records are immutable snapshots. A continued conversation must produce a
new AIR record linked to the previous one via a `related` entry, not a
mutation of the original:

```
continuedFrom | isVersionOf | hasVersion | isDerivedFrom | isSourceOf | relatedPublication
```

These map onto DataCite relation types in `datacite.json` and RO-Crate/PROV-O
relations in `ro-crate-metadata.json`.

## Versioning

This document describes AIR 0.1. Future versions must not silently change
the meaning of an existing field; a version bump accompanies any breaking
schema change, with migration notes. Parsers should remain able to read
older AIR packages when reasonable.

## Import fidelity and limits

Content blocks without a dedicated AIR representation are retained as JSON
in the `detail` of `system_event` records. Exposed additional Claude message
metadata, including attachment references, is retained in the same way.
ZIP imports retain references to additional files by original ZIP entry name
and uncompressed byte size in a source-file inventory event. Those bytes are
not copied into the output; a bulk export may contain files belonging to
other conversations. Keep the original export when those files are needed.
These inventory entries are references to the source ZIP, not package paths.

ChatGPT imports preserve all rooted components. Missing, contradictory, or
cyclic graph links fail explicitly. Claude parent links are resolved after
all messages have been read; unresolved parents fail rather than being
replaced with roots. Pasted transcripts parse role labels and one optional
separator space, and encode CRLF as LF; remaining content whitespace is
preserved. The datasheet records this transformation.

Branch statistics count additional children of each actual parent event,
including tool events. Independent roots and source-file inventories are
not counted as conversation forks.

Inputs are limited to 20 MiB. ZIPs are inspected before decompression and
limited to 100 MiB of declared expanded data and 1,000 entries. Duplicate or
unsafe entry paths are rejected. These limits also apply to ZIP validation.
