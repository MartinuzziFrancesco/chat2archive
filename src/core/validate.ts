// Package validation (§31): everything `chat2archive validate` checks.
// Operates on an in-memory file map so it runs identically from the CLI
// (unzip to memory) and, in the future, from the browser.

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { unzipBounded } from "./input.js";
import { validateEventGraph } from "./normalize.js";
import { AIR_SCHEMA } from "./schema.js";
import { sha256Hex, canonicalEventsJsonl } from "./hash.js";
import type { AirEvent } from "./model.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const REQUIRED_FILES = ["air.json", "conversation.jsonl", "ro-crate-metadata.json", "SHA256SUMS"];
const SUPPORTED_AIR_VERSIONS = ["0.1"];

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateAirJson = ajv.compile(AIR_SCHEMA);

/** `files` is keyed by path relative to the package root (no `air-record/` prefix). */
export async function validatePackageFiles(files: Map<string, Uint8Array>): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const decoder = new TextDecoder();
  const text = (path: string) => decoder.decode(files.get(path));

  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) errors.push(`Missing required file: ${required}`);
  }
  if (errors.length > 0) return { valid: false, errors, warnings };

  // air.json
  let airJson: any;
  let airJsonParsed = false;
  try {
    airJson = JSON.parse(text("air.json"));
    airJsonParsed = true;
  } catch (e) {
    errors.push(`air.json is not valid JSON: ${(e as Error).message}`);
  }
  if (airJsonParsed) {
    if (!validateAirJson(airJson)) {
      for (const err of validateAirJson.errors ?? []) {
        errors.push(`air.json schema violation at ${err.instancePath || "/"}: ${err.message}`);
      }
    }
    if (!SUPPORTED_AIR_VERSIONS.includes(airJson?.air_version)) {
      errors.push(`Unsupported AIR version: ${airJson?.air_version}`);
    }
  }

  // conversation.jsonl
  let events: AirEvent[] = [];
  const jsonlText = text("conversation.jsonl");
  const lines = jsonlText.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) errors.push("conversation.jsonl has no events.");
  for (const [i, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.id !== "string" || typeof parsed.type !== "string") {
        errors.push(`conversation.jsonl line ${i + 1}: event missing required "id"/"type" fields.`);
        continue;
      }
      events.push(parsed);
    } catch (e) {
      errors.push(`conversation.jsonl line ${i + 1} is not valid JSON: ${(e as Error).message}`);
    }
  }

  errors.push(...validateEventGraph(events));

  // canonical hash cross-check
  if (airJson?.canonical_sha256) {
    const recomputed = await sha256Hex(new TextEncoder().encode(canonicalEventsJsonl(events)));
    if (recomputed !== airJson.canonical_sha256) {
      errors.push(
        `canonical_sha256 in air.json (${airJson.canonical_sha256}) does not match recomputed hash of conversation.jsonl (${recomputed}).`
      );
    }
  }

  // ro-crate-metadata.json
  try {
    const rocrate = JSON.parse(text("ro-crate-metadata.json"));
    if (!Array.isArray(rocrate["@graph"])) {
      errors.push("ro-crate-metadata.json is missing a top-level @graph array.");
    }
  } catch (e) {
    errors.push(`ro-crate-metadata.json is not valid JSON: ${(e as Error).message}`);
  }

  // SHA256SUMS
  const sumLines = text("SHA256SUMS")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const summedPaths = new Set<string>();
  for (const line of sumLines) {
    const match = /^([a-f0-9]{64})\s\s(.+)$/.exec(line);
    if (!match) {
      errors.push(`SHA256SUMS line does not match "<hash>  <path>" format: "${line}"`);
      continue;
    }
    const [, expectedHash, path] = match as unknown as [string, string, string];
    summedPaths.add(path);
    const content = files.get(path);
    if (!content) {
      errors.push(`SHA256SUMS references "${path}" but it is not present in the package.`);
      continue;
    }
    const actualHash = await sha256Hex(content);
    if (actualHash !== expectedHash) {
      errors.push(`Hash mismatch for "${path}": SHA256SUMS says ${expectedHash}, actual is ${actualHash}.`);
    }
  }
  for (const path of files.keys()) {
    if (path !== "SHA256SUMS" && !summedPaths.has(path)) {
      errors.push(`SHA256SUMS is missing an entry for "${path}".`);
    }
  }

  // attachments referenced by path must exist
  for (const event of events) {
    if (event.type === "attachment" || event.type === "generated_file") {
      const path = (event as { path?: string | null }).path;
      if (path && !files.has(path)) {
        errors.push(`Event "${event.id}" references file "${path}" which is not present in the package.`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Unzips `zipBytes` (an air-record ZIP, with or without a single wrapping directory) into a validate-ready file map. */
export function filesFromZip(zipBytes: Uint8Array): Map<string, Uint8Array> {
  const unzipped = unzipBounded(zipBytes);
  const entries = Object.entries(unzipped);
  const commonPrefix = findCommonDirPrefix(entries.map(([p]) => p));
  const files = new Map<string, Uint8Array>();
  for (const [path, content] of entries) {
    if (path.endsWith("/")) continue;
    const relative = commonPrefix ? path.slice(commonPrefix.length) : path;
    files.set(relative, content);
  }
  return files;
}

function findCommonDirPrefix(paths: string[]): string | null {
  const first = paths[0];
  if (!first || !first.includes("/")) return null;
  const prefix = first.slice(0, first.indexOf("/") + 1);
  return paths.every((p) => p.startsWith(prefix)) ? prefix : null;
}
