# chat2archive

Turn a ChatGPT or Claude conversation into a provider-neutral, Zenodo-ready
research archive — an **AIR** (AI Interaction Record). No account or
database. Export conversion runs entirely client-side, in your browser or on
the command line; pasting a public ChatGPT or Claude share link uses a small
Cloudflare Worker to fetch that one page (see "Share-link support" below).

```text
ChatGPT / Claude export
          ↓
     chat2archive
          ↓
  AIR-compatible RO-Crate (ZIP)
          ↓
        Zenodo
          ↓
         DOI
```

`chat2archive`'s job is conversion and packaging. It is not a DOI provider,
a repository, a hosted chat viewer, or a place to store your conversations —
Zenodo remains responsible for preservation and DOI issuance.

## Quick start

### CLI

```bash
git clone https://github.com/MartinuzziFrancesco/chat2archive.git
cd chat2archive
npm install
npm run build

node dist/cli/index.js path/to/export.json --creator "Jane Doe" --orcid 0000-0000-0000-0000
# → jane-does-conversation.zip
```

Also works with an export `.zip`, a pasted transcript `.txt`, or stdin:

```bash
cat conversation.json | node dist/cli/index.js -
```

Validate a package:

```bash
node dist/cli/index.js validate air-record.zip
```

Run `node dist/cli/index.js --help` for all options.

### Web UI

```bash
npm run dev:web
# open http://localhost:8080
```

Paste a public ChatGPT or Claude share link, a transcript, or upload an
official ChatGPT/Claude export file. Export files and pasted transcripts are
processed entirely in the browser. Share links call the deployed Worker (see
below); parsing and packaging then preserve its public-share provenance
(`AIR-C1`).

The production build (`npm run build`, output in `dist/web/`) is a static
site deployed on GitHub Pages via `.github/workflows/pages.yml` — live at
<https://martinuzzifrancesco.github.io/chat2archive/> once Pages is enabled
for this repository (Settings → Pages → Source: GitHub Actions). The site
has no server component of its own — file upload and pasted transcripts work
with nothing else deployed; only share-link fetching depends on the Worker.

### Share-link support

GitHub Pages is 100% static, and browsers block a page's own script from
reading a cross-origin `fetch` of `chatgpt.com`/`claude.ai` directly (CORS)
— so something has to fetch the share page outside the browser. `src/worker/`
is a small [Cloudflare Worker](https://developers.cloudflare.com/workers/)
that does only that: given a share URL, it fetches the page (and, for
Claude, the JSON API the share page itself calls after loading — see
`src/importers/share.ts` for exactly what each provider needs) server-side
and returns the parsed conversation as JSON, with no storage and no user
credentials involved. It's a thin adapter around `share.ts`, the same code
the CLI could use for URL input.

Both providers' edges reject requests from a generic HTTP client outright,
so these requests carry a normal browser `User-Agent` — without it, nothing
is retrievable at all, regardless of implementation. Claude specifically
requires a second request: its share page is a client-rendered shell with
no conversation data in the HTML, so the Worker loads the page first (the
same as a real visitor's browser would) and carries its Cloudflare
`__cf_bm` cookie into the actual data request. A non-public or expired
share link fails with a clear error either way, from either provider.

To enable share-link import on your own deployment:

1. Create a free Cloudflare account and an API token with Workers edit
   permission ([dash.cloudflare.com](https://dash.cloudflare.com) →
   My Profile → API Tokens → "Edit Cloudflare Workers" template).
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets on this
   repository (Settings → Secrets and variables → Actions).
3. Push to `main` — `.github/workflows/worker.yml` deploys `src/worker/`
   automatically. (Or run `npx wrangler deploy` locally.)
4. Cloudflare prints the Worker's URL, `https://chat2archive-share.<your
   subdomain>.workers.dev`. Put it in `SHARE_API_URL` at the top of
   `src/web/main.ts`, then push — `pages.yml` redeploys the site.

Without this, the site still works fully for uploads and pasted transcripts;
pasting a link shows a clear error instead of failing silently.

## What you get

A ZIP containing:

```text
conversation.jsonl      the canonical, authoritative event log (JSONL)
air.json                record metadata, validated against schema/air-0.1.schema.json
INTERACTION.md           an auto-populated interaction datasheet
transcript.md / .html    human-readable renderings (not authoritative)
ro-crate-metadata.json   RO-Crate / JSON-LD package description
datacite.json / zenodo.json   suggested deposit metadata
SHA256SUMS               integrity hashes for every file in the package
README.md
```

See `docs/AIR-0.1.md` (also browsable at
<https://martinuzzifrancesco.github.io/chat2archive/spec.html>) for the full
format specification, and `docs/zenodo.md` for how to upload the result to
Zenodo.

## Supported inputs

| Format | Capture class |
|---|---|
| Official ChatGPT data export (`.zip` / `conversations.json`) | `AIR-C2` |
| Official Claude data export (`.zip` / `conversations.json`) | `AIR-C2` |
| Public ChatGPT share link (web UI, via the Worker) | `AIR-C1` |
| Public Claude share link (web UI, via the Worker) | `AIR-C1` |
| Pasted transcript (`User: … / Assistant: …`) | `AIR-C0` |

The Worker only accepts `chatgpt.com`/`chat.openai.com`/`claude.ai` share
links and does not follow redirects, use a signed-in user's session, or
execute provider scripts. Unavailable or non-public pages and unsupported
formats fail explicitly. CLI URL imports are not supported yet; use an
export instead. See `docs/provenance.md` for the capture-provenance model.

## Design

- **Fidelity over polish.** `chat2archive` never rewrites, corrects, or
  summarizes message content. Unknown metadata stays explicitly unknown
  (`evidence: "unknown"`), never silently inferred.
- **Branches are preserved.** `conversation.jsonl` is a graph (stable ids +
  `parent` references), not a flattened array — edits, regenerations, and
  alternative branches survive normalization when the source exposes them.
- **Determinism.** The same source and metadata always produce the same
  canonical hash; see `tests/package.test.ts`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Project layout:

```text
src/core/        shared model, hashing, transcript/RO-Crate/DataCite generation, packaging, validation
src/importers/   provider format detection + ChatGPT/Claude/generic parsers
src/cli/         CLI entry point
src/web/         browser UI
src/worker/      Cloudflare Worker: fetches public ChatGPT share pages for the deployed site
schema/          air-0.1.schema.json
fixtures/        synthetic sample exports used by the test suite
docs/            AIR-0.1.md, provenance.md, zenodo.md
```

## License

MIT — see `LICENSE`. This governs the `chat2archive` tool itself, not the
content of any conversation you archive with it (see `docs/zenodo.md` on
licensing your own archives).

## Citing

See `CITATION.cff`.
