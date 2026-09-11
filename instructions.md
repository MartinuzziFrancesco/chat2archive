# instructions.md — `chat2archive`

## 1. Mission

Build **`chat2archive`**, a small open-source tool that converts AI conversations into a standardized, provider-neutral archival research package that can be uploaded to **Zenodo** and assigned a DOI.

The core workflow is:

```text
ChatGPT / Claude / Gemini / other AI chat
                    ↓
                chat2archive
                    ↓
        standardized archival package
                    ↓
                  Zenodo
                    ↓
                    DOI
```

The project should **not** become a repository, DOI provider, social platform, hosted archive, or chat viewer service.

Its job is conversion and packaging.

The tool should have:

1. a **minimal static web interface** deployable on GitHub Pages;
2. a **CLI** that performs the same conversion locally and is the robust fallback when browser limitations prevent direct URL ingestion.

The aesthetic and interaction model should take inspiration from `doi2bib`: one obvious input, one obvious action, almost no navigation, no account, no dashboard, and minimal configuration.

---

## Naming

- **Project/tool/CLI:** `chat2archive`
- **Protocol:** AIR — AI Interaction Record
- **Archival package:** AIR-compatible RO-Crate

The public-facing name should stay independent of the underlying RO-Crate implementation so the project is not unnecessarily tied to one packaging technology.

## 2. Product principle

The product should feel like a scholarly utility, not a SaaS product.

The ideal interaction is:

```text
┌─────────────────────────────────────────────┐
│ chat2archive                                  │
│                                             │
│ Archive an AI conversation for research.   │
│                                             │
│ [ Paste a ChatGPT / Claude / Gemini URL ]  │
│                                             │
│              [ Create archive ]             │
│                                             │
│ or upload an export / JSON / HTML file      │
└─────────────────────────────────────────────┘
```

After conversion:

```text
✓ 37 messages
✓ 2 branches
✓ 3 attachments
✓ provider: Anthropic
✓ model: Claude ...
✓ capture provenance recorded
✓ SHA-256 manifest generated

[ Download Zenodo-ready ZIP ]
```

No sign-up. No database. No analytics by default. No permanent server-side storage. No monetization.

All processing should happen locally whenever technically possible.

---

## 3. Scope

### Build now

- Parse supported AI-chat formats.
- Normalize them into one provider-neutral event representation.
- Preserve branches when the source exposes them.
- Preserve available timestamps.
- Preserve attachments or references to attachments when available.
- Preserve tool calls/results when exposed by the source.
- Record exactly how the conversation was obtained.
- Distinguish observed metadata from inferred or user-supplied metadata.
- Generate a human-readable transcript.
- Generate a machine-readable research package.
- Generate cryptographic hashes.
- Generate RO-Crate metadata.
- Generate Zenodo/DataCite-ready metadata.
- Produce one downloadable ZIP.
- Provide the same core functionality through a CLI.
- Deploy the static web interface on GitHub Pages.

### Explicitly do not build now

- A DOI minting service.
- A permanent repository.
- User accounts.
- Payments.
- Collaboration features.
- A hosted chat viewer.
- Search across archived chats.
- Social sharing.
- AI summarization of conversations.
- Automatic scientific claims about reproducibility.
- Re-import into ChatGPT or Claude as a live conversation.
- A backend solely to work around traffic limits.

Zenodo remains responsible for preservation and DOI issuance.

---

## 4. Conceptual basis

Do not invent a completely isolated metadata ecosystem.

The archival format should be an **RO-Crate profile for AI interaction records**.

Working protocol name:

**AIR — AI Interaction Record**

Initial version:

**AIR 0.1**

The conceptual stack is:

| Concern | Existing standard / prior art | AIR use |
|---|---|---|
| Human documentation | Datasheets for Datasets | interaction documentation |
| Research-object packaging | RO-Crate | normative package structure |
| Provenance | W3C PROV-O | provenance semantics |
| Web capture | WARC | optional preservation of source pages |
| Dataset/schema design precedent | MLCommons Croissant | example of a domain-specific JSON-LD profile |
| DOI metadata | DataCite Metadata Schema | Zenodo-compatible bibliographic metadata |

The intellectual design principle inherited from Datasheets for Datasets is:

> Preserve not only the artifact, but the circumstances under which the artifact was created, selected, transformed, and distributed.

For AI chats, adapt this into:

> **Preserve what was observed; document how it was obtained; identify what is unknown; never infer provenance silently.**

---

## 5. Normative archival object

An AIR record represents an **observable AI interaction**, not a claim to reproduce the provider's internal inference execution.

The record may contain:

```text
AI Interaction
├── human participants
├── AI agents / models
├── messages
├── branches
├── edits / regenerations
├── tool calls
├── tool results
├── citations
├── attachments
├── generated artifacts
└── provenance
```

AIR must remain provider-neutral.

Provider-specific structures belong in import adapters, not in the canonical schema.

---

## 6. Canonical event representation

Use **JSONL** as the canonical transcript/event representation.

File:

```text
conversation.jsonl
```

One event per line.

Every event MUST have:

```json
{
  "id": "event-001",
  "type": "message"
}
```

Supported event types in AIR 0.1:

```text
message
tool_call
tool_result
attachment
generated_file
citation
edit
regeneration
branch
system_event
```

Event types should be extensible.

A message example:

```json
{
  "id": "msg-001",
  "type": "message",
  "role": "user",
  "timestamp": "2026-09-10T14:02:31Z",
  "parent": null,
  "content": [
    {
      "type": "text",
      "text": "Explain this result."
    }
  ]
}
```

Assistant response:

```json
{
  "id": "msg-002",
  "type": "message",
  "role": "assistant",
  "parent": "msg-001",
  "timestamp": "2026-09-10T14:02:34Z",
  "agent": "agent-001",
  "content": [
    {
      "type": "text",
      "text": "The result suggests..."
    }
  ]
}
```

Tool call example:

```json
{
  "id": "tool-004",
  "type": "tool_call",
  "parent": "msg-008",
  "tool": "web_search",
  "arguments_available": false
}
```

Do not require all providers to expose all fields.

Missing information must be represented honestly.

---

## 7. Conversation graph

Do not model a chat as a simple array.

The canonical format must support a graph/tree using stable event IDs and `parent` references.

Example:

```text
m1
 ↓
m2
 ├── m3a
 │    ↓
 │   m4a
 │
 └── m3b
      ↓
     m4b
```

This is needed for:

- edited prompts;
- regenerated answers;
- alternative branches;
- retries;
- provider-specific conversation trees.

A rendered Markdown/HTML transcript may flatten or visually separate branches, but `conversation.jsonl` must retain the source structure when it is available.

If the imported source exposes only a flat sequence, do not invent branching information.

---

## 8. Model and system metadata

Model identity must include **evidence provenance**.

Do not silently turn an inferred model name into a factual claim.

Example:

```yaml
model:
  name: "Claude Sonnet 4.5"
  provider: "Anthropic"
  evidence: "displayed_in_ui"
```

Allowed evidence values for AIR 0.1:

```text
api_response
provider_export
displayed_in_ui
share_page
user_reported
inferred
unknown
```

Apply the same principle to other execution metadata:

```yaml
temperature:
  value: null
  availability: "not_exposed"

system_prompt:
  value: null
  availability: "not_available"
```

Suggested availability vocabulary:

```text
available
partially_available
not_exposed
not_available
redacted
unknown
```

AIR must not imply that it captures hidden provider state.

In general it cannot guarantee access to:

- hidden system prompts;
- full context construction;
- provider-side routing;
- model weights;
- safety classifiers;
- inference seeds;
- undisclosed preprocessing;
- undisclosed tool calls;
- exact hidden sampling configuration.

State this clearly in generated documentation.

---

## 9. Capture provenance

Every archive must say **how the conversation entered `chat2archive`**.

Define Capture Provenance Classes.

Initial vocabulary:

| Class | Source | Interpretation |
|---|---|---|
| `AIR-C0` | pasted transcript | user-supplied text, weakest provenance |
| `AIR-C1` | public share URL captured by tool | tool observed a publicly accessible provider page |
| `AIR-C2` | official provider export | source came from an official account export |
| `AIR-C3` | authenticated API/provider record | source obtained from an authenticated provider/API response |
| `AIR-C4` | cryptographically/provider-signed record | reserved for future use |

Example:

```yaml
capture:
  class: AIR-C1
  source_uri: "https://chatgpt.com/share/..."
  captured_at: "2026-09-10T15:32:11Z"
  capture_software: "chat2archive/0.1.0"
```

Call these **capture provenance classes**, not verification levels.

They describe evidence about acquisition, not truthfulness of the conversation.

---

## 10. Integrity

Generate SHA-256 hashes for all archival files.

Required:

```text
SHA256SUMS
```

Also include a canonical hash for the normalized interaction.

Example metadata:

```yaml
canonical_sha256: "97e2..."
```

Hash the canonical normalized representation deterministically.

Document the canonicalization algorithm in the specification and test it with fixtures.

Never claim that a hash proves the conversation was authentic. It proves only that a particular archived byte sequence has not changed since hashing.

---

## 11. Package structure

A standard AIR package should look approximately like this:

```text
air-record/
│
├── README.md
├── INTERACTION.md
│
├── conversation.jsonl
├── transcript.md
├── transcript.html
│
├── attachments/
│   └── ...
│
├── provenance/
│   └── source.warc.gz        # optional
│
├── ro-crate-metadata.json
├── datacite.json
├── zenodo.json
├── air.json
└── SHA256SUMS
```

### Normative vs convenience files

Normative:

```text
conversation.jsonl
air.json
ro-crate-metadata.json
SHA256SUMS
```

Generated convenience/rendering files:

```text
README.md
INTERACTION.md
transcript.md
transcript.html
datacite.json
zenodo.json
```

`transcript.html` must be self-contained and readable offline.

It is a human-readable rendering, not the authoritative transcript.

Do not depend on an external hosted viewer to make the archive readable.

---

## 12. `air.json`

`air.json` should contain AIR-specific record metadata that is awkward or unnecessarily verbose to encode directly in the event stream.

Minimum fields:

```json
{
  "air_version": "0.1",
  "title": "...",
  "creator": [],
  "conversation_created_at": null,
  "capture_created_at": "...",
  "provider": "...",
  "source_uri": "...",
  "license": null,
  "capture": {},
  "agents": [],
  "canonical_sha256": "..."
}
```

Use stable, documented field semantics.

Create a JSON Schema for `air.json`.

Example:

```text
schema/air-0.1.schema.json
```

Validate output against it.

---

## 13. Human documentation: `INTERACTION.md`

Generate a concise human-readable interaction datasheet.

Sections:

### Motivation
Why was this interaction conducted?

### Participants
Who interacted with the system? Were multiple people involved?

### System
Which provider, model, and interface were used? Which metadata is directly observed vs inferred?

### Interaction conditions
Were browsing, tools, files, project instructions, memory, custom instructions, or external context involved, when known?

### Selection
Is this the whole source conversation, one branch, or an excerpt?

### Modification
Were messages edited, regenerated, translated, reordered, reformatted, or redacted?

### External material
What files, URLs, datasets, or external resources entered the interaction?

### Intended use
Why is the record being archived?

### Limitations
What relevant information could not be captured?

### Ethics and privacy
Does the archive contain personal, confidential, copyrighted, or third-party material?

### Maintenance and versioning
Is this an immutable snapshot? Does it supersede or derive from another record?

Do not force the user to fill every section before export.

Auto-populate everything deterministically available from the source and allow optional user editing of the rest.

The default path should remain extremely short.

---

## 14. RO-Crate

Treat the package as an **AIR Profile of RO-Crate**.

`ro-crate-metadata.json` should:

- describe the root dataset/research object;
- describe contained files;
- describe human creators where supplied;
- describe AI/software agents where known;
- include source/provider URLs;
- include licensing information;
- include timestamps;
- link related works where supplied;
- represent provenance relationships where practical;
- identify the AIR profile/version.

Use JSON-LD and standard RO-Crate/schema.org vocabulary wherever existing terms are adequate.

Avoid inventing AIR properties when an established property already captures the concept.

Use W3C PROV-O semantics where RO-Crate/schema.org alone is insufficient for provenance.

---

## 15. Zenodo and DataCite metadata

Generate metadata that a researcher can use during Zenodo deposit.

Suggested DataCite mapping:

| AIR | DataCite |
|---|---|
| creator | Creator |
| title | Title |
| archive/publication year | PublicationYear |
| interaction date | Date |
| license | Rights |
| original share URL | RelatedIdentifier |
| related publication | RelatedIdentifier |
| AIR version / record version | Version |
| keywords | Subject |

For initial deposits, suggest:

```text
resourceTypeGeneral: Dataset
resourceType: AI Interaction
```

Treat this as a provisional convention, not a universal truth.

Where possible, generate:

```text
datacite.json
zenodo.json
```

The project should not require Zenodo API credentials for its base workflow.

Future optional functionality may pre-populate a Zenodo deposition through the official API, but the first release should simply generate the package and metadata.

---

## 16. Relationships between records

Archived conversations are immutable snapshots.

A continued conversation should produce a new AIR record.

Do not mutate the old archival object.

Support relationships such as:

```text
continuedFrom
isVersionOf
hasVersion
isDerivedFrom
isSourceOf
relatedPublication
```

Map to standard DataCite/PROV relations where appropriate rather than inventing duplicates.

Conceptually:

```text
AIR-001
"original archived conversation"
    │
    │ continuedFrom / derivedFrom
    ↓
AIR-002
"follow-up conversation"
```

---

## 17. Web capture / WARC

When a direct public share URL can be fetched reliably, optionally preserve a raw source capture.

Preferred archival format:

```text
provenance/source.warc.gz
```

WARC should be considered optional in AIR 0.1.

Do not make successful conversion depend on WARC creation.

If browser security prevents a static site from retrieving the source page, do not route user conversations through an opaque third-party proxy by default.

---

## 18. Browser architecture

The web version must be deployable as a **static GitHub Pages site**.

Preferred properties:

- no backend;
- no account;
- no database;
- no cookies unless strictly necessary;
- no tracking/analytics by default;
- client-side parsing;
- client-side ZIP generation;
- client-side hashing;
- client-side HTML/Markdown generation;
- small dependency footprint.

### Important limitation: CORS

GitHub Pages cannot act as a server-side scraper.

Directly fetching ChatGPT, Claude, Gemini, or other share URLs may fail because of provider CORS policies, anti-bot controls, authentication, or changing page structures.

Therefore web ingestion must have graceful fallback modes:

1. **Share URL** — attempt when technically possible.
2. **Upload provider export** — preferred reliable browser path.
3. **Upload JSON/HTML** — parser auto-detects format.
4. **Paste transcript/source** — lowest-provenance fallback.
5. **CLI command** — recommended when URL fetching cannot be performed from the browser.

Never upload the user's conversation to `chat2archive` servers merely to bypass CORS.

The privacy advantage of a local static utility is a feature.

---

## 19. CLI

The CLI should expose the same normalization and packaging library as the web interface.

The parsers/core package should not be duplicated between implementations.

Target UX:

```bash
chat2archive https://chatgpt.com/share/...
```

Output:

```text
air-record.zip
```

Also support:

```bash
chat2archive conversation.json
chat2archive export.zip
chat2archive transcript.html
```

Suggested options:

```bash
chat2archive INPUT
  -o, --output PATH
  --title TEXT
  --creator TEXT
  --orcid ID
  --license SPDX_ID
  --related-doi DOI
  --format zip|directory
  --no-warc
  --quiet
  --json
```

Support stdin where sensible:

```bash
cat conversation.json | chat2archive -
```

Do not bury the common path under configuration.

Running with one input argument should usually be enough.

---

## 20. Provider adapters

Design provider ingestion as isolated adapters.

Example:

```text
src/importers/
├── chatgpt.ts
├── claude.ts
├── gemini.ts
├── generic.ts
└── detect.ts
```

Each importer returns the same canonical internal model.

The canonical model must not contain provider-specific assumptions.

Initial implementation priority:

1. ChatGPT official export;
2. ChatGPT public shared conversation when fetchable;
3. Claude official export;
4. Claude public shared conversation when fetchable;
5. generic pasted transcript;
6. Gemini after the above are stable.

Do not block v0.1 on supporting every provider.

Every importer needs fixture-based tests.

Provider page structures are unstable; parsers should fail explicitly rather than silently generating corrupted records.

---

## 21. Detection

The tool should auto-detect input format whenever possible.

Possible inputs:

```text
URL
ZIP
JSON
HTML
Markdown/text
```

Return a clear diagnosis:

```text
Detected: ChatGPT official export
Detected: Claude public share
Detected: generic transcript
Unable to identify format
```

Do not ask users to choose a provider before trying detection.

---

## 22. Minimal web UX

The website should be one page.

Suggested hierarchy:

```text
chat2archive

Turn an AI conversation into a research archive
ready for Zenodo.

[ paste URL or drop a file                     ]
[ Create archive ]

Supports ChatGPT and Claude.
Everything is processed locally when possible.

-----------------------------------------------

What you get
conversation.jsonl · RO-Crate · transcript ·
provenance metadata · SHA-256 hashes

[CLI] [format specification] [GitHub]
```

Do not add:

- hero illustrations;
- marketing sections;
- testimonials;
- animated backgrounds;
- dashboards;
- sidebars;
- pricing;
- newsletters;
- unnecessary onboarding.

Design should be visually quiet and fast.

Use accessible semantic HTML.

Mobile should work, but this is primarily a research utility.

---

## 23. Post-conversion screen

Show only information useful for validating the archive.

Example:

```text
Archive ready

37 messages
2 branches
3 attachments

Provider        Anthropic
Model           Claude ...
Model evidence  displayed_in_ui
Capture         AIR-C1 public share URL
Integrity       SHA-256 generated

[ Download ZIP ]

Next: upload the ZIP to Zenodo.
```

Provide expandable advanced metadata editing if needed, but keep it closed by default.

---

## 24. Metadata editing

Allow optional editing before package creation:

- title;
- creator name;
- ORCID;
- license;
- keywords;
- description;
- related DOI;
- intended use;
- redaction/selection notes.

Fields extracted from the source should display their provenance.

Example:

```text
Model: Claude Sonnet ...
Source: displayed in provider UI
```

Never overwrite observed values with guessed values without recording the change.

---

## 25. Privacy and ethics

The app handles potentially sensitive research material.

Requirements:

- process locally whenever possible;
- avoid server-side logging;
- no third-party analytics by default;
- no automatic transmission to AI APIs;
- warn before packaging personal/confidential information;
- make source URLs visible before export;
- support redaction metadata;
- distinguish a redacted record from a complete record;
- never claim that public availability implies an unrestricted redistribution license.

Licensing must be user-selected or sourced from an authoritative source.

Do not default arbitrary conversations to CC BY.

If no license is known, use `null` / unspecified and explain this in metadata.

---

## 26. Fidelity rules

The converter should preserve source information rather than beautify it.

Do not:

- rewrite message text;
- fix spelling;
- normalize quotations;
- summarize responses;
- remove provider metadata unless requested;
- infer missing timestamps;
- invent model versions;
- collapse branches silently;
- convert uncertain facts into authoritative metadata.

Normalization should affect structure and encoding, not semantic content.

Record any unavoidable transformation.

---

## 27. Generated transcript

Generate:

```text
transcript.md
transcript.html
```

The transcript should contain:

- title;
- archive metadata;
- participants/agents;
- chronological conversation rendering;
- branch markers;
- tool-call markers;
- attachments;
- citations;
- a provenance footer.

The HTML version must:

- work offline;
- embed CSS locally;
- require no JavaScript to read;
- avoid external fonts/assets;
- remain visually simple.

This is a fallback readable artifact, not a separate viewer product.

---

## 28. Rehydration

AIR should make future rendering straightforward, but restoring the archive as a live provider conversation is **not a protocol requirement**.

Distinguish:

```text
AIR → interactive reconstruction/viewer      possible
AIR → searchable/citable historical record   possible
AIR → context for a new model interaction    possible
AIR → exact restoration of provider state    not guaranteed
```

The archival object is immutable.

If someone continues an archived conversation later, that continuation should become a new AIR record with a provenance relationship to the previous one.

---

## 29. Implementation structure

Prefer a single codebase with a shared core.

A reasonable layout:

```text
chat2archive/
├── README.md
├── LICENSE
├── CITATION.cff
├── package.json
│
├── src/
│   ├── core/
│   │   ├── model.ts
│   │   ├── normalize.ts
│   │   ├── hash.ts
│   │   ├── package.ts
│   │   ├── rocrate.ts
│   │   ├── datacite.ts
│   │   └── transcript.ts
│   │
│   ├── importers/
│   │   ├── detect.ts
│   │   ├── chatgpt.ts
│   │   ├── claude.ts
│   │   └── generic.ts
│   │
│   ├── cli/
│   │   └── index.ts
│   │
│   └── web/
│       └── ...
│
├── schema/
│   ├── air-0.1.schema.json
│   └── examples/
│
├── fixtures/
│   ├── chatgpt/
│   ├── claude/
│   └── generic/
│
├── tests/
└── docs/
    ├── AIR-0.1.md
    ├── provenance.md
    └── zenodo.md
```

TypeScript is a pragmatic choice because the same core can run in Node and the browser.

Other implementations are acceptable if they retain this shared-core property.

---

## 30. Determinism

Given the same source object and same explicitly supplied metadata, `chat2archive` should generate semantically identical canonical output.

Control nondeterministic ZIP metadata where feasible.

Canonical hash calculation must not depend on:

- current filesystem path;
- ZIP ordering;
- generated temporary filenames;
- locale;
- whitespace differences introduced by rendering;
- current time except the explicitly recorded capture event.

Create reproducibility tests.

---

## 31. Validation

Provide:

```bash
chat2archive validate archive.zip
```

Validation should check:

- required AIR files exist;
- `air.json` validates against schema;
- JSONL parses;
- all parent references resolve or are explicitly external;
- hashes match;
- RO-Crate metadata parses;
- referenced attachments exist;
- AIR version is supported.

Return machine-readable output with `--json`.

---

## 32. Security

Treat imported HTML/JSON as untrusted.

Requirements:

- never execute imported scripts;
- sanitize HTML;
- avoid `innerHTML` with untrusted content;
- guard ZIP extraction against path traversal;
- apply reasonable input-size limits in the browser;
- stream or bound memory usage where practical;
- never execute attachment contents;
- escape transcript output;
- validate URLs before fetching;
- do not send provider credentials anywhere.

The CLI should use ordinary HTTP semantics and identify itself clearly.

Do not implement provider authentication by scraping user cookies.

---

## 33. Testing

Minimum test categories:

### Unit
- provider format detection;
- parsing;
- event normalization;
- branch reconstruction;
- model evidence handling;
- hash generation;
- DataCite mapping;
- RO-Crate generation.

### Fixtures
Keep anonymized/synthetic fixtures for each supported provider and format.

### Golden files
For canonical normalized output, maintain golden fixtures to detect accidental schema drift.

### Round-trip rendering
Verify that `conversation.jsonl` can produce readable Markdown and HTML without losing canonical messages.

### Browser
Test current Chromium, Firefox, and Safari.

### CLI
Test Linux, macOS, and Windows where feasible.

---

## 34. Versioning

AIR is a versioned protocol.

Use semantic-ish protocol versions:

```text
AIR 0.1
AIR 0.2
AIR 1.0
```

Do not silently change field meanings.

Every package must declare:

```json
{
  "air_version": "0.1"
}
```

Publish migration notes whenever the schema changes.

Parsers should remain able to read older AIR packages when reasonable.

---

## 35. Open-source posture

The project should be open source.

Prefer a permissive license unless there is a specific reason not to.

Include:

```text
LICENSE
CITATION.cff
CONTRIBUTING.md
CODE_OF_CONDUCT.md
```

Make the protocol specification usable independently of the reference implementation.

The long-term value is the interoperable format, not control of a hosted service.

---

## 36. Relationship to Zenodo

The correct product boundary is:

```text
chat2archive                      Zenodo
──────────                      ──────
parse provider data             preserve object
normalize conversation          host object
document provenance             assign DOI
generate RO-Crate               version deposits
generate metadata               expose public record
generate hashes
```

Do not duplicate Zenodo's preservation role.

Initially, the final call to action should simply be:

> Download ZIP → upload to Zenodo.

A later optional Zenodo API integration may reduce manual metadata entry, but it should remain separable from the core converter.

---

## 37. Relationship to viewers

Existing ChatGPT/Claude export viewers demonstrate that reconstructing a chat-like UI is feasible.

That is not the main contribution of this project.

The missing useful layer is:

```text
provider-specific conversation
            ↓
     common archival format
            ↓
        scholarly repository
```

`transcript.html` is sufficient as the human-readable fallback for v0.1.

Do not spend early development time building a hosted viewer.

A future independent AIR viewer can consume `conversation.jsonl` / RO-Crate directly.

---

## 38. MVP acceptance criteria

Version `0.1.0` is done when all of the following work:

1. A user can open the GitHub Pages site.
2. The user can upload a supported ChatGPT export.
3. The user can upload a supported Claude export.
4. The tool automatically detects the format.
5. The conversion happens locally in the browser.
6. The user receives one ZIP.
7. The ZIP contains:
   - `conversation.jsonl`
   - `air.json`
   - `INTERACTION.md`
   - `transcript.md`
   - `transcript.html`
   - `ro-crate-metadata.json`
   - `datacite.json`
   - `zenodo.json`
   - `SHA256SUMS`
8. Branches present in the source survive normalization.
9. Unknown metadata remains explicitly unknown.
10. Model metadata includes evidence provenance.
11. The package validates against the AIR 0.1 schema.
12. The CLI produces the same canonical record from the same input.
13. `chat2archive validate` verifies a generated package.
14. The website is deployed through GitHub Pages.
15. The README explains how to upload the result to Zenodo.
16. No account or backend is required.

Direct public-share URL support is desirable for v0.1 but must not delay the first working release if CORS/provider restrictions make it unreliable.

---

## 39. Development order

Implement in this order:

```text
1. canonical AIR data model
2. JSON Schema
3. ChatGPT export parser
4. Claude export parser
5. normalization + branch model
6. canonical hashing
7. transcript.md / transcript.html
8. RO-Crate metadata
9. DataCite / Zenodo metadata
10. ZIP packaging
11. validation
12. CLI
13. minimal browser UI
14. GitHub Pages deployment
15. best-effort public share URL ingestion
16. additional providers
```

Do not start with styling.

Do not start with a backend.

Do not start with DOI integration.

Get deterministic conversion correct first.

---

## 40. Research/design references

The implementation agent should read these before finalizing AIR 0.1:

### Datasheets for Datasets
Gebru et al., *Datasheets for Datasets*.

Purpose: model for systematic documentation of artifact motivation, composition, collection, use, distribution, and maintenance.

https://arxiv.org/abs/1803.09010

### RO-Crate
Research Object Crate specification.

Purpose: normative research-object packaging and JSON-LD metadata framework.

https://www.researchobject.org/ro-crate/

### W3C PROV-O
W3C Provenance Ontology.

Purpose: standardized provenance concepts such as Entity, Activity, Agent, `wasGeneratedBy`, and `wasDerivedFrom`.

https://www.w3.org/TR/prov-o/

### DataCite Metadata Schema
Purpose: map AIR metadata to DOI-oriented scholarly metadata used by repositories.

https://schema.datacite.org/

### Zenodo Developers
Purpose: understand deposition metadata and potential future optional API integration.

https://developers.zenodo.org/

### WARC
ISO 28500 / WARC ecosystem.

Purpose: optional archival capture of public share pages.

https://www.loc.gov/preservation/digital/formats/fdd/fdd000236.shtml

### MLCommons Croissant
Purpose: useful precedent for defining a focused domain-specific metadata profile by building on existing web/research metadata standards.

https://docs.mlcommons.org/croissant/

### doi2bib
Purpose: UX inspiration only — a narrowly scoped scholarly utility with a simple input → output interaction.

https://github.com/mseri/doi2bib

---

## 41. Final product test

Before adding a feature, ask:

> Does this make AI conversations easier to convert into durable, transparent, interoperable research objects?

If no, leave it out.

The project succeeds if a researcher can go from an AI conversation to a well-documented Zenodo-ready research object in seconds, while another researcher years later can determine:

- what was preserved;
- which participant/model produced each observable event;
- what source the archive came from;
- which metadata is known vs inferred;
- whether the archived bytes have changed;
- what context or provider state was unavailable;
- and how the object relates to subsequent versions or publications.

That is the product.
