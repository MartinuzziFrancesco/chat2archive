#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

import { importAny } from "../importers/detect.js";
import { buildPackage, zipPackage, slugify } from "../core/package.js";
import { validatePackageFiles, filesFromZip } from "../core/validate.js";
import type { AirRecord } from "../core/model.js";

const HELP = `chat2archive — convert an AI conversation into a Zenodo-ready AIR archive.

Usage:
  chat2archive <input> [options]
  chat2archive validate <archive.zip> [--json]
  cat conversation.json | chat2archive -

<input> is a file path to an official ChatGPT/Claude export (.zip or .json),
a plain transcript (.txt), or "-" to read from stdin. Provider share URLs
are not fetched directly yet in v0.1 — download an official export instead.

Options:
  -o, --output PATH        Output path (default: <title>.zip, or a directory with --format directory)
      --title TEXT          Override the archive title
      --creator TEXT        Creator name (repeatable)
      --orcid ID            ORCID for the creator (paired with the last --creator)
      --license SPDX_ID     SPDX license identifier
      --related-doi DOI     Related DOI (relation: relatedPublication)
      --format zip|directory  Output format (default: zip)
      --conversation-id ID     Select a specific conversation from a multi-conversation export
      --conversation-index N   Select a specific conversation by 0-based index
  -q, --quiet               Suppress the summary
      --json                Print the summary as JSON
  -h, --help                Show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      title: { type: "string" },
      creator: { type: "string", multiple: true },
      orcid: { type: "string" },
      license: { type: "string" },
      "related-doi": { type: "string" },
      format: { type: "string", default: "zip" },
      "conversation-id": { type: "string" },
      "conversation-index": { type: "string" },
      quiet: { type: "boolean", short: "q", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  if (positionals[0] === "validate") {
    await runValidate(positionals[1], Boolean(values.json));
    return;
  }

  await runConvert(positionals[0]!, values as CliOptions);
}

interface CliOptions {
  output?: string;
  title?: string;
  creator?: string[];
  orcid?: string;
  license?: string;
  "related-doi"?: string;
  format?: string;
  "conversation-id"?: string;
  "conversation-index"?: string;
  quiet?: boolean;
  json?: boolean;
}

async function runValidate(archivePath: string | undefined, asJson: boolean): Promise<void> {
  if (!archivePath) {
    process.stderr.write("Usage: chat2archive validate <archive.zip>\n");
    process.exit(1);
  }
  const bytes = readFileSync(archivePath);
  const files = filesFromZip(new Uint8Array(bytes));
  const result = await validatePackageFiles(files);

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (result.valid) {
    process.stdout.write(`✓ ${archivePath} is a valid AIR 0.1 package.\n`);
    for (const w of result.warnings) process.stdout.write(`  warning: ${w}\n`);
  } else {
    process.stdout.write(`✗ ${archivePath} failed validation:\n`);
    for (const e of result.errors) process.stdout.write(`  error: ${e}\n`);
    for (const w of result.warnings) process.stdout.write(`  warning: ${w}\n`);
  }
  process.exit(result.valid ? 0 : 1);
}

async function runConvert(input: string, opts: CliOptions): Promise<void> {
  if (/^https?:\/\//i.test(input)) {
    process.stderr.write(
      "Direct provider share-URL fetching is not implemented in chat2archive 0.1.0.\n" +
        "Download an official ChatGPT/Claude export (or copy/paste the transcript) and pass that instead.\n"
    );
    process.exit(1);
  }

  if (opts.format !== "zip" && opts.format !== "directory") {
    throw new Error("Output format must be zip or directory.");
  }

  const bytes = new Uint8Array(readFileSync(input === "-" ? 0 : input));

  const select: { id?: string; index?: number } = {};
  if (opts["conversation-id"]) select.id = opts["conversation-id"];
  if (opts["conversation-index"] !== undefined) select.index = Number(opts["conversation-index"]);

  // source_uri is a provenance claim about where the conversation was observed,
  // not a local filesystem path — a file/stdin input carries no such URI.
  const imported = importAny(bytes, {
    sourceUri: null,
    select: select.id || select.index !== undefined ? select : undefined,
  });

  let record: AirRecord = imported.record;
  if (opts.title) record = { ...record, title: opts.title };
  if (opts.license) record = { ...record, license: opts.license };
  if (opts.creator && opts.creator.length > 0) {
    record = {
      ...record,
      creator: opts.creator.map((name, i) => ({
        name,
        orcid: i === opts.creator!.length - 1 ? opts.orcid ?? null : null,
      })),
    };
  }
  if (opts["related-doi"]) {
    record = {
      ...record,
      related: [...record.related, { relation: "relatedPublication", identifier: opts["related-doi"] }],
    };
  }

  const built = await buildPackage(record);
  for (const w of [...imported.warnings.map((w) => w.message), ...built.warnings]) {
    process.stderr.write(`warning: ${w}\n`);
  }

  const format = opts.format === "directory" ? "directory" : "zip";
  const outPath = opts.output ?? defaultOutputPath(built.record.title, format);

  if (format === "directory") {
    for (const [path, content] of built.files) {
      const full = join(outPath, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  } else {
    mkdirSync(dirname(outPath) || ".", { recursive: true });
    writeFileSync(outPath, zipPackage(built));
  }

  if (opts.quiet) return;

  const summary = {
    output: outPath,
    format: imported.detected,
    messages: built.stats.messageCount,
    branches: built.stats.branchCount,
    tool_calls: built.stats.toolCallCount,
    attachments: built.stats.attachmentCount,
    provider: built.record.provider,
    model: built.record.agents[0]?.model.name ?? null,
    model_evidence: built.record.agents[0]?.model.evidence ?? null,
    capture_class: built.record.capture.class,
    canonical_sha256: built.record.canonical_sha256,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  process.stdout.write(`Archive ready → ${outPath}\n\n`);
  process.stdout.write(`  ${summary.messages} messages\n`);
  process.stdout.write(`  ${summary.branches} branches\n`);
  process.stdout.write(`  ${summary.attachments} attachments\n\n`);
  process.stdout.write(`  Provider        ${summary.provider ?? "unknown"}\n`);
  process.stdout.write(`  Model           ${summary.model ?? "unknown"} (evidence: ${summary.model_evidence})\n`);
  process.stdout.write(`  Capture         ${summary.capture_class}\n`);
  process.stdout.write(`  Integrity       SHA-256 generated (${summary.canonical_sha256?.slice(0, 12)}…)\n\n`);
  process.stdout.write(`Next: upload the archive to https://zenodo.org/deposit/new\n`);
}

function defaultOutputPath(title: string, format: "zip" | "directory"): string {
  const slug = slugify(title);
  return format === "directory" ? slug : `${slug}.zip`;
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
