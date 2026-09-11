# Contributing to chat2archive

Thanks for your interest. This project is intentionally narrow in scope —
see `instructions.md` for the founding design document and §3/§41 in
particular for what's explicitly out of scope.

## Before adding a feature

Ask: does this make AI conversations easier to convert into durable,
transparent, interoperable research objects? If not, it likely doesn't
belong here.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

- Core conversion logic lives in `src/core/` and must run unchanged in
  Node and the browser (no Node-only APIs — see `src/core/hash.ts` for the
  pattern).
- Provider parsers live in `src/importers/`, one file per provider, each
  returning the same canonical model (`src/core/model.ts`). Add
  fixture-based tests for any new or changed importer under `fixtures/` and
  `tests/`.
- Provider export formats are unstable and undocumented. Parsers must fail
  explicitly (throw a clear error) rather than silently produce a corrupted
  or partially-invented record.

## Fidelity rules

Do not rewrite, correct, summarize, or reformat message content during
normalization. Do not infer a fact (model name, timestamp, license) and
present it as observed — tag it with the correct `evidence`/`availability`
vocabulary instead (see `docs/provenance.md`).

## Schema changes

`schema/air-0.1.schema.json` is generated from `src/core/schema.ts`
(`tests/schema.test.ts` enforces they match). Any change to `air.json`'s
shape is a protocol change — see the versioning rules in
`docs/AIR-0.1.md` before changing field meanings on an existing version.

## Reporting issues

Open a GitHub issue. For a broken importer, please attach an anonymized
fixture that reproduces the problem if you can.
