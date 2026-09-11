import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importAny } from "../src/importers/detect.js";
import { buildPackage, zipPackage } from "../src/core/package.js";
import { validatePackageFiles, filesFromZip } from "../src/core/validate.js";
import { generateDataCiteMetadata, generateZenodoMetadata } from "../src/core/datacite.js";
import { sha256Hex } from "../src/core/hash.js";

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

test("validation catches duplicate event ids in conversation.jsonl", async () => {
  const built = await buildChatGptFixture();
  const files = filesFromZip(zipPackage(built));
  const dup = '{"id":"x","type":"message","role":"user","content":[]}\n';
  files.set("conversation.jsonl", new TextEncoder().encode(dup + dup));
  const result = await validatePackageFiles(files);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Duplicate event id "x"')));
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

test("validation rejects a falsy-but-valid air.json instead of skipping it", async () => {
  const built = await buildChatGptFixture();
  for (const falsyJson of ["null", "false", "0"]) {
    built.files.set("air.json", new TextEncoder().encode(falsyJson));
    const result = await validatePackageFiles(built.files);
    assert.equal(result.valid, false, `air.json = ${falsyJson} should fail validation`);
    assert.ok(
      result.errors.some((e) => e.includes("schema violation") || e.includes("Unsupported AIR version")),
      `air.json = ${falsyJson} should report a schema/version error, got: ${result.errors.join("; ")}`
    );
  }
});

test("validation requires SHA256SUMS to cover every packaged file and rejects malformed lines", async () => {
  const built = await buildChatGptFixture();

  const emptySums = new Map(built.files);
  emptySums.set("SHA256SUMS", new TextEncoder().encode(""));
  const emptyResult = await validatePackageFiles(emptySums);
  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.errors.some((e) => e.includes("SHA256SUMS is missing an entry for")));

  const malformedSums = new Map(built.files);
  malformedSums.set("SHA256SUMS", new TextEncoder().encode("not-a-valid-line\n"));
  const malformedResult = await validatePackageFiles(malformedSums);
  assert.equal(malformedResult.valid, false);
  assert.ok(malformedResult.errors.some((e) => e.includes('does not match "<hash>  <path>" format')));
});

test("ro-crate-metadata.json references every packaged file with its actual hash", async () => {
  const built = await buildChatGptFixture();
  const rocrate = JSON.parse(new TextDecoder().decode(built.files.get("ro-crate-metadata.json")));
  const graph = rocrate["@graph"] as Array<Record<string, unknown>>;
  const root = graph.find((n) => n["@id"] === "./")!;
  const hasPart = (root.hasPart as Array<{ "@id": string }>).map((p) => p["@id"]);
  const fileHashes = new Map(
    graph.filter((n) => n["@type"] === "File").map((n) => [n["@id"] as string, n.sha256 as string])
  );

  for (const [path, content] of built.files) {
    // Both are generated after the @graph (see the comment in package.ts): ro-crate-metadata.json
    // can't describe its own bytes, and SHA256SUMS is built last and includes ro-crate-metadata.json's
    // hash, so the graph can't reference SHA256SUMS's hash without a circular dependency either.
    if (path === "ro-crate-metadata.json" || path === "SHA256SUMS") continue;
    assert.ok(hasPart.includes(path), `ro-crate hasPart missing ${path}`);
    const actualHash = await sha256Hex(content);
    assert.equal(fileHashes.get(path), actualHash, `ro-crate hash for ${path} does not match packaged bytes`);
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
