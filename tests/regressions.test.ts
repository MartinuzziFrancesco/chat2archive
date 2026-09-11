import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { importAny } from "../src/importers/detect.js";
import { importClaudeExport } from "../src/importers/claude.js";
import { buildPackage } from "../src/core/package.js";
import { validatePackageFiles } from "../src/core/validate.js";
import { sha256Hex, canonicalEventsJsonl } from "../src/core/hash.js";
import { computeStats } from "../src/core/normalize.js";
import { renderTranscriptMarkdown, renderTranscriptHtml } from "../src/core/transcript.js";
import { renderInteractionMarkdown } from "../src/core/datasheet.js";
import { checkInputSize, MAX_INPUT_BYTES, MAX_EXPANDED_BYTES, unzipBounded } from "../src/core/input.js";
import type { AirEvent } from "../src/core/model.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const shell = () => importAny("User: hello\nAssistant: reply").record;

test("validation rejects cycles and invalid references even with correct hashes", async () => {
  const built = await buildPackage(shell());
  const cases: AirEvent[][] = [
    [{ id: "x", type: "branch", parent: "x" }],
    [{ id: "x", type: "branch", parent: "y" }, { id: "y", type: "branch", parent: "x" }],
    [{ id: "x", type: "tool_result", tool_call: "missing", result_available: false }],
    [{ id: "x", type: "edit", edited_event: "missing" }],
    [{ id: "x", type: "regeneration", original_event: "missing" }],
    [{ id: "x", type: "message", role: "user", content: [{ type: "attachment_ref", attachment_id: "missing" }] }],
    [{ id: "x", type: "tool_result", tool_call: "y", result_available: false }, { id: "y", type: "branch" }],
  ];
  for (const events of cases) {
    const files = new Map(built.files);
    const conversation = enc.encode(canonicalEventsJsonl(events));
    files.set("conversation.jsonl", conversation);
    const metadata = JSON.parse(dec.decode(files.get("air.json")));
    metadata.canonical_sha256 = await sha256Hex(conversation);
    files.set("air.json", enc.encode(JSON.stringify(metadata)));
    const sums = [];
    for (const [path, bytes] of files) if (path !== "SHA256SUMS") sums.push(`${await sha256Hex(bytes)}  ${path}`);
    files.set("SHA256SUMS", enc.encode(sums.join("\n") + "\n"));
    const result = await validatePackageFiles(files);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /Cycle|reference/.test(e)), result.errors.join("; "));
    assert.ok(!result.errors.some(e => /Hash mismatch/.test(e)));
    await assert.rejects(buildPackage({ ...shell(), events }), /Cycle|reference/);
  }
});

test("tool forks are counted and rendered with compatible public calls", () => {
  const record = shell();
  record.events = [
    { id: "p", type: "message", parent: null, role: "user", content: [{ type: "text", text: "question" }] },
    { id: "t", type: "tool_call", parent: "p", tool: "search", arguments_available: false },
    { id: "m", type: "message", parent: "p", role: "assistant", content: [{ type: "text", text: "answer" }] },
  ];
  const stats = computeStats(record.events);
  assert.equal(stats.branchCount, 1);
  assert.deepEqual([...stats.branchStarts], ["t", "m"]);
  const markdown = renderTranscriptMarkdown(record);
  const html = renderTranscriptHtml(record);
  assert.equal(markdown, renderTranscriptMarkdown(record, stats));
  assert.equal(html, renderTranscriptHtml(record, stats));
  assert.equal((markdown.match(/_↳ branch point_/g) ?? []).length, 2);
  assert.equal((html.match(/<div class="branch-point">/g) ?? []).length, 2);
  assert.match(renderInteractionMarkdown(record, { intendedUse: "Research" }), /Research/);
  assert.equal(renderInteractionMarkdown(record), renderInteractionMarkdown(record, {}, stats));
});

test("unsupported source blocks and ZIP references survive packaging", async () => {
  const block = { type: "image", source: { data: "original bytes" } };
  const conversation = { uuid: "c", chat_messages: [{ uuid: "m", sender: "human", content: [block], attachments: [{ file_name: "image.png" }] }] };
  const zip = zipSync({ "conversations.json": enc.encode(JSON.stringify(conversation)), "image.png": enc.encode("image") });
  const imported = importAny(zip);
  const built = await buildPackage(imported.record);
  const events = dec.decode(built.files.get("conversation.jsonl")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(JSON.parse(events[0].detail), block);
  assert.deepEqual(JSON.parse(events[1].detail), { attachments: [{ file_name: "image.png" }] });
  const references = JSON.parse(events[2].detail);
  assert.deepEqual(references.files, [{ filename: "image.png", size: 5 }]);
  assert.match(references.note, /bytes are not included/);
  assert.match(dec.decode(built.files.get("INTERACTION.md")), /file bytes are not included/);
  assert.equal(built.stats.branchCount, 0);
  assert.equal((await validatePackageFiles(built.files)).valid, true);
  assert.throws(() => importClaudeExport({ uuid: "c", chat_messages: [{ uuid: "m", sender: "human", text: "hi", parent_message_uuid: "absent" }] }), /absent/);
});

test("input limits and unsafe ZIP paths fail before conversion", () => {
  assert.throws(() => checkInputSize(MAX_INPUT_BYTES + 1), /20 MB/);
  assert.throws(() => importAny(new Uint8Array(MAX_INPUT_BYTES + 1)), /20 MB/);
  for (const path of ["../escape", "/absolute", "C:/escape", "a\\b", "a/../b"]) {
    assert.throws(() => unzipBounded(zipSync({ [path]: enc.encode("x") })), /Unsafe ZIP path/);
  }
  const many = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`f${i}`, new Uint8Array()]));
  assert.throws(() => unzipBounded(zipSync(many)), /1000-entry/);
  // Inflated size is inspected from the directory before decompression.
  const zip = zipSync({ "x": enc.encode("x") });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, MAX_EXPANDED_BYTES + 1, true);
      break;
    }
  }
  assert.throws(() => unzipBounded(zip), /expanded-size|Invalid ZIP entry size/);
});
