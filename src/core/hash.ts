// Canonicalization and hashing. Runs unchanged in Node and in the browser:
// both expose the Web Crypto API (`globalThis.crypto.subtle`).

/**
 * Deterministic JSON serialization: object keys sorted, no insignificant
 * whitespace. Array order is preserved (it is semantically significant).
 * This is the canonicalization algorithm referenced throughout AIR-0.1.md.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJsonStringify((value as Record<string, unknown>)[k])}`
    );
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

/**
 * The canonical JSONL byte content for a sequence of events: one
 * canonically-serialized event per line, no trailing newline on the last
 * line's content before the final "\n" terminator, LF-only.
 */
export function canonicalEventsJsonl(events: unknown[]): string {
  return events.map((e) => canonicalJsonStringify(e)).join("\n") + "\n";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexOfString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}
