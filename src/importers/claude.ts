// Importer for Claude ("claude.ai") conversation data: both the official
// bulk data export (conversations.json) and the live share-page snapshot
// (see share.ts), which share the same `chat_messages` shape. The official
// export doesn't expose parent/branch links, so those messages chain
// sequentially; a share snapshot's `parent_message_uuid` field, when
// present, is used to reconstruct real branch structure instead — per the
// spec, we use branch info when the source exposes it and never invent it
// when the source doesn't.

import type { AirEvent, AirRecord, ImportResult, MessageEvent, TextBlock } from "../core/model.js";
import { newCaptureProvenance, newRecordShell } from "./shared.js";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface ClaudeMessage {
  uuid: string;
  text?: string;
  sender: string;
  created_at?: string;
  content?: ClaudeContentBlock[];
  /**
   * Present on live share-page snapshots (not the official bulk data export),
   * which use "00000000-0000-4000-8000-000000000000" as the root sentinel.
   * When present we use it to reconstruct real branch structure instead of
   * assuming a flat chain.
   */
  parent_message_uuid?: string;
}

const CLAUDE_ROOT_PARENT_SENTINEL = "00000000-0000-4000-8000-000000000000";

interface ClaudeConversation {
  uuid: string;
  name?: string;
  created_at?: string;
  chat_messages: ClaudeMessage[];
}

export function looksLikeClaudeExport(data: unknown): boolean {
  const conv = Array.isArray(data) ? data[0] : data;
  return conv !== null && typeof conv === "object" && "chat_messages" in (conv as object);
}

function selectConversation(
  data: unknown,
  select?: { id?: string; index?: number }
): { conversation: ClaudeConversation; count: number } {
  const list: ClaudeConversation[] = Array.isArray(data) ? data : [data as ClaudeConversation];
  if (select?.id) {
    const found = list.find((c) => c.uuid === select.id);
    if (!found) throw new Error(`No Claude conversation with id "${select.id}" found.`);
    return { conversation: found, count: list.length };
  }
  const index = select?.index ?? 0;
  const conversation = list[index];
  if (!conversation) throw new Error(`No Claude conversation at index ${index}.`);
  return { conversation, count: list.length };
}

export function importClaudeExport(
  data: unknown,
  opts: { sourceUri?: string | null; select?: { id?: string; index?: number } } = {}
): ImportResult {
  const warnings: string[] = [];
  const { conversation, count } = selectConversation(data, opts.select);
  if (count > 1 && !opts.select) {
    warnings.push(
      `Input contains ${count} conversations; used the first one. Pass --conversation-index or --conversation-id to select another.`
    );
  }

  const messages = conversation.chat_messages ?? [];
  if (messages.length === 0) {
    throw new Error("Claude export conversation has no messages.");
  }

  const events: AirEvent[] = [];
  const lastEventIdByMessageUuid = new Map<string, string>();
  // Cross-message parent links can't be resolved on the first pass: a
  // message's parent_message_uuid may point to a message this loop hasn't
  // reached yet (or, in a malformed export, to one that doesn't exist at
  // all). Record each message's entry-point event here and patch its
  // `parent` once every message has been assigned an id, instead of
  // guessing by falling back to whatever event happened to come before it.
  const pendingParentLinks: { msgUuid: string; eventId: string; parentMessageUuid: string | undefined }[] = [];


  for (const msg of messages) {
    const role = msg.sender === "human" ? "user" : "assistant";
    const blocks = msg.content && msg.content.length > 0 ? msg.content : textOnlyBlocks(msg.text);

    let internalPrev: string | null = null;
    let firstEventId: string | null = null;
    const recordEvent = (eventId: string) => {
      if (firstEventId === null) firstEventId = eventId;
      internalPrev = eventId;
    };

    const textBlocks: TextBlock[] = [];
    let messagePartIndex = 0;

    const flushMessage = () => {
      if (textBlocks.length === 0) return;
      const eventId = `msg-${msg.uuid}${messagePartIndex > 0 ? `-${messagePartIndex}` : ""}`;
      messagePartIndex += 1;
      const event: MessageEvent = {
        id: eventId,
        type: "message",
        role,
        parent: internalPrev,
        timestamp: msg.created_at ?? null,
        agent: role === "assistant" ? "agent-claude" : null,
        content: textBlocks.splice(0, textBlocks.length),
      };
      events.push(event);
      recordEvent(eventId);
    };

    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        textBlocks.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        flushMessage();
        const toolEventId = `tool-${block.id ?? `${msg.uuid}-call`}`;
        events.push({
          id: toolEventId,
          type: "tool_call",
          parent: internalPrev,
          timestamp: msg.created_at ?? null,
          tool: block.name ?? "unknown",
          arguments: block.input,
          arguments_available: block.input !== undefined,
        });
        recordEvent(toolEventId);
      } else if (block.type === "tool_result") {
        flushMessage();
        const toolCallRef = block.tool_use_id ? `tool-${block.tool_use_id}` : internalPrev ?? "unknown";
        const resultEventId = `toolresult-${block.tool_use_id ?? `${msg.uuid}-result`}`;
        events.push({
          id: resultEventId,
          type: "tool_result",
          parent: internalPrev,
          timestamp: msg.created_at ?? null,
          tool_call: toolCallRef,
          result: block.content,
          result_available: block.content !== undefined,
        });
        recordEvent(resultEventId);
      } else {
        flushMessage();
        const id = `source-${msg.uuid}-${events.length}`;
        events.push({ id, type: "system_event", parent: internalPrev,
          timestamp: msg.created_at ?? null,
          label: `Source content block: ${block.type}`, detail: JSON.stringify(block) });
        recordEvent(id);
      }
    }
    flushMessage();

    // Preserve exposed message metadata (including attachment references)
    // without making provider-specific fields part of the AIR vocabulary.
    const handled = new Set(["uuid", "text", "sender", "created_at", "content", "parent_message_uuid"]);
    const metadata = Object.fromEntries(Object.entries(msg).filter(([key]) => !handled.has(key)));
    if (Object.keys(metadata).length > 0) {
      const id = `source-metadata-${msg.uuid}`;
      events.push({ id, type: "system_event", parent: internalPrev,
        label: "Source message metadata", detail: JSON.stringify(metadata) });
      recordEvent(id);
    }

    if (firstEventId !== null) {
      pendingParentLinks.push({ msgUuid: msg.uuid, eventId: firstEventId, parentMessageUuid: msg.parent_message_uuid });
    }
    if (internalPrev !== null) lastEventIdByMessageUuid.set(msg.uuid, internalPrev);
  }

  if (events.length === 0) {
    throw new Error("Claude export conversation contained no renderable messages.");
  }

  // Resolve each message's link to the rest of the graph now that every
  // message has a known id, independent of the order messages appeared in.
  const eventById = new Map(events.map((e) => [e.id, e]));
  let sequentialPrev: string | null = null;
  for (const { msgUuid, eventId, parentMessageUuid } of pendingParentLinks) {
    const event = eventById.get(eventId)!;
    if (parentMessageUuid === undefined) {
      // This export format carries no branch info at all: chain sequentially.
      event.parent = sequentialPrev;
    } else if (parentMessageUuid === CLAUDE_ROOT_PARENT_SENTINEL) {
      event.parent = null;
    } else {
      const resolved = lastEventIdByMessageUuid.get(parentMessageUuid);
      if (resolved === undefined) {
        throw new Error(`Message "${msgUuid}" references parent "${parentMessageUuid}" which was not found in this export.`);
      } else {
        event.parent = resolved;
      }
    }
    sequentialPrev = lastEventIdByMessageUuid.get(msgUuid) ?? sequentialPrev;
  }

  const record: AirRecord = {
    ...newRecordShell(),
    title: conversation.name || "Untitled Claude conversation",
    conversation_created_at: conversation.created_at ?? null,
    provider: "Anthropic",
    source_uri: opts.sourceUri ?? null,
    capture: newCaptureProvenance("AIR-C2", opts.sourceUri ?? null),
    agents: [
      {
        id: "agent-claude",
        name: "Claude",
        model: { name: null, provider: "Anthropic", evidence: "unknown" },
      },
    ],
    events,
  };

  return { record, warnings: warnings.map((message) => ({ message })) };
}

function textOnlyBlocks(text?: string): ClaudeContentBlock[] {
  if (!text) return [];
  return [{ type: "text", text }];
}
