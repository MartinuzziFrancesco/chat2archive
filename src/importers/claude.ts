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
  let previousEventId: string | null = null;
  const lastEventIdByMessageUuid = new Map<string, string>();

  for (const msg of messages) {
    const role = msg.sender === "human" ? "user" : "assistant";
    const blocks = msg.content && msg.content.length > 0 ? msg.content : textOnlyBlocks(msg.text);

    if (msg.parent_message_uuid !== undefined) {
      previousEventId =
        msg.parent_message_uuid === CLAUDE_ROOT_PARENT_SENTINEL
          ? null
          : lastEventIdByMessageUuid.get(msg.parent_message_uuid) ?? previousEventId;
    }

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
        parent: previousEventId,
        timestamp: msg.created_at ?? null,
        agent: role === "assistant" ? "agent-claude" : null,
        content: textBlocks.splice(0, textBlocks.length),
      };
      events.push(event);
      previousEventId = eventId;
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
          parent: previousEventId,
          timestamp: msg.created_at ?? null,
          tool: block.name ?? "unknown",
          arguments: block.input,
          arguments_available: block.input !== undefined,
        });
        previousEventId = toolEventId;
      } else if (block.type === "tool_result") {
        flushMessage();
        const toolCallRef = block.tool_use_id ? `tool-${block.tool_use_id}` : previousEventId ?? "unknown";
        const resultEventId = `toolresult-${block.tool_use_id ?? `${msg.uuid}-result`}`;
        events.push({
          id: resultEventId,
          type: "tool_result",
          parent: previousEventId,
          timestamp: msg.created_at ?? null,
          tool_call: toolCallRef,
          result: block.content,
          result_available: block.content !== undefined,
        });
        previousEventId = resultEventId;
      }
    }
    flushMessage();
    if (previousEventId !== null) lastEventIdByMessageUuid.set(msg.uuid, previousEventId);
  }

  if (events.length === 0) {
    throw new Error("Claude export conversation contained no renderable messages.");
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
