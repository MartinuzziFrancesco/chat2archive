# Uploading an AIR archive to Zenodo

`chat2archive` generates a package; **Zenodo remains responsible for
preservation and DOI issuance.** This tool never calls Zenodo's API and
never requires credentials for its base workflow.

## Steps

1. Run `chat2archive` (CLI or the web UI) to produce `<title>.zip`.
2. Go to <https://zenodo.org/deposit/new> (create a free account if needed).
3. Upload the ZIP file as-is, or unzip it first and upload its contents —
   either is fine; Zenodo does not require a specific archive structure.
4. Fill in the deposit form using `zenodo.json` (inside the archive) as a
   reference:
   - **Title** ← `metadata.title`
   - **Creators** ← `metadata.creators`
   - **Description** ← `metadata.description`
   - **Keywords** ← `metadata.keywords`
   - **License** ← `metadata.license` (leave unset if `null` — see below)
   - **Related/alternate identifiers** ← `metadata.related_identifiers`
5. Set **Resource type** to **Dataset**. `chat2archive` suggests
   `resourceType: "AI Interaction"` in `datacite.json` as a free-text
   qualifier under Dataset; Zenodo/DataCite do not yet have a dedicated
   controlled resource type for AI interaction records, so this is a
   provisional convention, not a claim that Zenodo formally recognizes it.
6. Publish. Zenodo assigns and mints the DOI at this point — `chat2archive`
   has no role in DOI minting.

## About the license field

If `air.json`'s `license` is `null`, the archive does not claim any
copyright license over the conversation content. **Do not default an
unreviewed conversation to a permissive license** (e.g. CC BY) just because
it will be uploaded publicly — public visibility does not imply an
unrestricted redistribution right, and the underlying conversation may
contain material the archiving researcher does not have the right to
relicense. Set a license explicitly (`--license SPDX_ID` on the CLI, or the
metadata panel in the web UI) only when you know it applies.

## Versioning a continued conversation

If this archive continues from a previously archived (and Zenodo-published)
conversation, pass its DOI:

```bash
chat2archive export.json --related-doi 10.5281/zenodo.1234567
```

This is recorded as a `relatedPublication` relation in `air.json`,
`datacite.json`, and `ro-crate-metadata.json`. Zenodo also has its own
native "new version" mechanism for a deposit; use whichever is a more
accurate description of the relationship — a **new version of the same
record** (Zenodo versioning) vs. a **related but separate conversation**
(AIR `related` metadata).
