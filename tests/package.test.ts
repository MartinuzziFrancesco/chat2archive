import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importAny } from "../src/importers/detect.js";
import { buildPackage, zipPackage } from "../src/core/package.js";
import { validatePackageFiles, filesFromZip } from "../src/core/validate.js";
import { generateRoCrateMetadata } from "../src/core/rocrate.js";
import { generateDataCiteMetadata, generateZenodoMetadata } from "../src/core/datacite.js";

async function buildChatGptFixture() {
  const raw = readFileSync("fixtures/chatgpt/branching.json", "utf-8");
  const imported = importAny(raw);
  return buildPackage(imported.record);
}

test("buildPackage produces every required v0.1 file", async () => {
  const built = await buildChatGptFixture();
  const expected = [
    "conversation.jsonl",
    "air.json",
    "INTERACTION.md",
    "transcript.md",
    "transcript.html",
    "ro-crate-metadata.json",
    "datacite.json",
    "zenodo.json",
    "SHA256SUMS",
    "README.md",
  ];
  for (const path of expected) {
    assert.ok(built.files.has(path), `missing ${path}`);
  }
});

test("a built, zipped package round-trips through validation cleanly", async () => {
  const built = await buildChatGptFixture();
  const zipBytes = zipPackage(built);
  const files = filesFromZip(zipBytes);
  const result = await validatePackageFiles(files);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("validation catches a tampered conversation.jsonl (hash mismatch)", async () => {
  const built = await buildChatGptFixture();
  const zipBytes = zipPackage(built);
  const files = filesFromZip(zipBytes);
  files.set("conversation.jsonl", new TextEncoder().encode('{"id":"tampered","type":"message"}\n'));
  const result = await validatePackageFiles(files);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("canonical_sha256") || e.includes("Hash mismatch")));
});

test("validation catches a missing required file", async () => {
  const built = await buildChatGptFixture();
  const files = new Map(built.files);
  files.delete("air.json");
  const result = await validatePackageFiles(files);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing required file: air.json")));
});

test("building and zipping the same record twice produces byte-identical ZIPs", async () => {
  const imported = importAny(readFileSync("fixtures/chatgpt/branching.json", "utf-8"));
  const built1 = await buildPackage(imported.record);
  const built2 = await buildPackage(structuredClone(imported.record));
  assert.deepEqual(zipPackage(built1), zipPackage(built2));
});

test("package validation applies the published metadata schema", async () => {
  const built = await buildChatGptFixture();
  const metadata = JSON.parse(new TextDecoder().decode(built.files.get("air.json")));
  delete metadata.title;
  built.files.set("air.json", new TextEncoder().encode(JSON.stringify(metadata)));
  const result = await validatePackageFiles(built.files);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("schema violation") && error.includes("title")));
});

test("ro-crate-metadata.json references every packaged file with a matching hash", async () => {
  const built = await buildChatGptFixture();
  const rocrate = generateRoCrateMetadata(
    built.record,
    [...built.files.keys()].map((path) => ({ path, sha256: "0".repeat(64) }))
  );
  const graph = rocrate["@graph"] as Array<Record<string, unknown>>;
  const root = graph.find((n) => n["@id"] === "./")!;
  const hasPart = root.hasPart as Array<{ "@id": string }>;
  for (const path of built.files.keys()) {
    assert.ok(hasPart.some((p) => p["@id"] === path), `ro-crate hasPart missing ${path}`);
  }
});

test("DataCite and Zenodo metadata carry the license and related DOI through", async () => {
  const built = await buildChatGptFixture();
  built.record.license = "CC-BY-4.0";
  built.record.related = [{ relation: "relatedPublication", identifier: "10.5281/zenodo.1234" }];

  const dc = generateDataCiteMetadata(built.record);
  assert.equal(dc.rightsList[0]?.rights, "CC-BY-4.0");
  assert.ok(dc.relatedIdentifiers.some((r) => r.relatedIdentifier === "10.5281/zenodo.1234"));

  const zen = generateZenodoMetadata(built.record);
  assert.equal(zen.metadata.license, "CC-BY-4.0");
  assert.ok(zen.metadata.related_identifiers.some((r) => r.identifier === "10.5281/zenodo.1234"));
});
