// Format auto-detection and single entry point for all importers.
// Providers should never have to be chosen manually before detection is
// attempted (§21 of instructions.md).

import { unzipSync } from "fflate";
import type { ImportResult } from "../core/model.js";
import { importChatGptExport, looksLikeChatGptExport } from "./chatgpt.js";
import { importClaudeExport, looksLikeClaudeExport } from "./claude.js";
import { importGenericTranscript } from "./generic.js";

export type DetectedFormat =
  | "chatgpt_export"
  | "claude_export"
  | "generic_transcript"
  | "unknown";

export interface ImportOptions {
  sourceUri?: string | null;
  select?: { id?: string; index?: number };
}

export interface DetectedImportResult extends ImportResult {
  detected: DetectedFormat;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

function detectJsonShape(data: unknown): "chatgpt_export" | "claude_export" | "unknown" {
  if (looksLikeChatGptExport(data)) return "chatgpt_export";
  if (looksLikeClaudeExport(data)) return "claude_export";
  return "unknown";
}

function findConversationsJson(files: Record<string, Uint8Array>): Uint8Array | null {
  const entries = Object.entries(files);
  const byName = entries.find(([name]) => /(^|\/)conversations\.json$/i.test(name));
  if (byName) return byName[1];
  const anyJson = entries.find(([name]) => name.toLowerCase().endsWith(".json"));
  return anyJson ? anyJson[1] : null;
}

/**
 * Detect the format of `input` and run the matching importer.
 * `input` is either raw text (paste box / stdin) or raw file bytes
 * (uploaded/opened file, which may be a ZIP export archive).
 */
export function importAny(
  input: string | Uint8Array,
  opts: ImportOptions = {}
): DetectedImportResult {
  let jsonCandidate: unknown | undefined;
  let plainText: string | undefined;

  if (input instanceof Uint8Array) {
    if (isZip(input)) {
      const files = unzipSync(input);
      const found = findConversationsJson(files);
      if (!found) {
        throw new Error(
          "The ZIP file did not contain a conversations.json. " +
            "Expected an official ChatGPT or Claude data export archive."
        );
      }
      jsonCandidate = JSON.parse(new TextDecoder().decode(found));
    } else {
      plainText = new TextDecoder().decode(input);
    }
  } else {
    plainText = input;
  }

  if (jsonCandidate === undefined && plainText !== undefined) {
    try {
      jsonCandidate = JSON.parse(plainText);
    } catch {
      // Not JSON: fall through to the generic transcript importer.
    }
  }

  if (jsonCandidate !== undefined) {
    const shape = detectJsonShape(jsonCandidate);
    if (shape === "chatgpt_export") {
      return { detected: shape, ...importChatGptExport(jsonCandidate, opts) };
    }
    if (shape === "claude_export") {
      return { detected: shape, ...importClaudeExport(jsonCandidate, opts) };
    }
    throw new Error(
      "Input parses as JSON but does not match a recognized ChatGPT or Claude export shape. " +
        "Refusing to guess: pass a plain pasted transcript instead if this is not an official export."
    );
  }

  if (plainText !== undefined && plainText.trim().length > 0) {
    return { detected: "generic_transcript", ...importGenericTranscript(plainText, opts) };
  }

  throw new Error("Unable to identify input format: input was empty.");
}
