// Importer for a plain pasted transcript: the lowest-provenance fallback
// (AIR-C0). Lines that open with a recognized role label start a new
// message; everything else is appended to the current message's text.

import type { AirEvent, AirRecord, ImportResult, MessageEvent, Role } from "../core/model.js";
import { newCaptureProvenance, newRecordShell } from "./shared.js";

const ROLE_LABELS: Record<string, Role> = {
  user: "user",
  you: "user",
  human: "user",
  me: "user",
  prompt: "user",
  assistant: "assistant",
  ai: "assistant",
  chatgpt: "assistant",
  claude: "assistant",
  gemini: "assistant",
  bot: "assistant",
  system: "system",
};

const LABEL_LINE = /^\s*([A-Za-z][A-Za-z0-9 _-]{0,20}):\s?(.*)$/;

/**
 * Drops fully-blank lines from the start/end of a message's buffered lines
 * without touching leading/trailing whitespace *within* a real line (e.g. an
 * indented code block as the first line of a message) — unlike a plain
 * `.trim()` on the joined string, which strips that indentation too.
 */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim().length === 0) start++;
  while (end > start && lines[end - 1]!.trim().length === 0) end--;
  return lines.slice(start, end);
}

export function importGenericTranscript(text: string, opts: { sourceUri?: string | null } = {}): ImportResult {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const events: AirEvent[] = [];
  let previousEventId: string | null = null;
  let currentRole: Role | null = null;
  let buffer: string[] = [];
  let index = 0;

  const flush = () => {
    if (currentRole === null) return;
    const trimmed = trimBlankLines(buffer);
    buffer = [];
    if (trimmed.length === 0) return;
    const content = trimmed.join("\n");
    index += 1;
    const eventId = `msg-${String(index).padStart(3, "0")}`;
    const event: MessageEvent = {
      id: eventId,
      type: "message",
      role: currentRole,
      parent: previousEventId,
      timestamp: null,
      agent: currentRole === "assistant" ? "agent-unknown" : null,
      content: [{ type: "text", text: content }],
    };
    events.push(event);
    previousEventId = eventId;
  };

  for (const line of lines) {
    const match = LABEL_LINE.exec(line);
    const role = match ? ROLE_LABELS[match[1]!.toLowerCase().trim()] : undefined;
    if (match && role) {
      flush();
      currentRole = role;
      buffer.push(match[2] ?? "");
    } else if (currentRole !== null) {
      buffer.push(line);
    } else if (line.trim().length > 0) {
      // Text before any recognized role label: treat the whole transcript
      // as a single user-supplied block rather than discarding it.
      currentRole = "user";
      buffer.push(line);
    }
  }
  flush();

  if (events.length === 0) {
    throw new Error(
      "Could not find any recognizable messages in the pasted transcript. " +
        'Expected lines like "User: ..." or "Assistant: ...".'
    );
  }
  if (!events.some((e) => e.type === "message" && e.role === "assistant")) {
    warnings.push("No assistant turns were recognized in this transcript; only user text was found.");
  }
  warnings.push(
    "Pasted transcripts are the weakest capture provenance class (AIR-C0): role labels, message boundaries, and ordering were inferred from plain text, not observed from provider structure."
  );

  const record: AirRecord = {
    ...newRecordShell(),
    title: "Untitled pasted transcript",
    conversation_created_at: null,
    provider: null,
    source_uri: opts.sourceUri ?? null,
    capture: newCaptureProvenance("AIR-C0", opts.sourceUri ?? null),
    agents: [
      {
        id: "agent-unknown",
        name: null,
        model: { name: null, provider: null, evidence: "unknown" },
      },
    ],
    events,
  };

  return { record, warnings: warnings.map((message) => ({ message })) };
}
