// Importer for the official ChatGPT data export (conversations.json).
// Format: array of conversation objects, each holding a `mapping` of
// node-id -> {message, parent, children}. This is the source of AIR's
// conversation graph for ChatGPT.

import type { AirEvent, AirRecord, ImportResult, MessageEvent, Role } from "../core/model.js";
import { newCaptureProvenance, newRecordShell } from "./shared.js";

interface ChatGptAuthor {
  role: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

interface ChatGptContent {
  content_type: string;
  parts?: unknown[];
  text?: string;
}

interface ChatGptMessage {
  id: string;
  author: ChatGptAuthor;
  create_time?: number | null;
  content?: ChatGptContent;
  metadata?: Record<string, unknown>;
}

interface ChatGptNode {
  id: string;
  message?: ChatGptMessage | null;
  parent?: string | null;
  children: string[];
}

interface ChatGptConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping: Record<string, ChatGptNode>;
  current_node?: string;
  conversation_id?: string;
  id?: string;
}

export function looksLikeChatGptExport(data: unknown): boolean {
  const conv = Array.isArray(data) ? data[0] : data;
  return conv !== null && typeof conv === "object" && "mapping" in (conv as object);
}

function selectConversation(
  data: unknown,
  select?: { id?: string; index?: number }
): { conversation: ChatGptConversation; count: number } {
  const list: ChatGptConversation[] = Array.isArray(data) ? data : [data as ChatGptConversation];
  if (select?.id) {
    const found = list.find((c) => c.conversation_id === select.id || c.id === select.id);
    if (!found) throw new Error(`No ChatGPT conversation with id "${select.id}" found.`);
    return { conversation: found, count: list.length };
  }
  const index = select?.index ?? 0;
  const conversation = list[index];
  if (!conversation) throw new Error(`No ChatGPT conversation at index ${index}.`);
  return { conversation, count: list.length };
}

function partsToText(content?: ChatGptContent): string {
  if (!content) return "";
  if (typeof content.text === "string") return content.text;
  if (!content.parts) return "";
  return content.parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join("\n");
}

function mapRole(role: string): Role {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "system";
}

function isoFromUnix(seconds?: number | null): string | null {
  if (seconds === undefined || seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

export function importChatGptExport(
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

  const mapping = conversation.mapping ?? {};
  const nodeIds = Object.keys(mapping);
  if (nodeIds.length === 0) throw new Error("ChatGPT export conversation has an empty mapping.");

  // Preserve all roots; dangling links are errors, not inferred roots.
  const roots = nodeIds.filter((id) => {
    const parentId = mapping[id]?.parent;
    if (parentId && !Object.hasOwn(mapping, parentId)) throw new Error(`Missing ChatGPT parent "${parentId}".`);
    return !parentId;
  });
  if (roots.length === 0) {
    throw new Error(
      "ChatGPT export conversation graph has no root node: every node has a parent, which means the graph is cyclic or malformed."
    );
  }

  const events: AirEvent[] = [];
  const visited = new Set<string>();
  const stack: { nodeId: string; parentEventId: string | null }[] = roots.slice().reverse().map(nodeId => ({ nodeId, parentEventId: null }));

  while (stack.length > 0) {
    const { nodeId, parentEventId } = stack.pop()!;
    if (visited.has(nodeId)) {
      throw new Error(
        `ChatGPT export conversation graph is malformed: node "${nodeId}" is reachable more than once (a cycle or a shared child), which chat2archive cannot represent as a tree.`
      );
    }
    visited.add(nodeId);
    const node = Object.hasOwn(mapping, nodeId) ? mapping[nodeId] : undefined;
    if (!node) throw new Error(`Missing ChatGPT child node "${nodeId}".`);
    let thisEventParent = parentEventId;

    const msg = node.message;
    const text = partsToText(msg?.content);
    if (msg && msg.author && text.trim()) {
      const eventId = `msg-${msg.id}`;
      const event: MessageEvent = {
        id: eventId,
        type: "message",
        role: mapRole(msg.author.role),
        parent: parentEventId,
        timestamp: isoFromUnix(msg.create_time),
        agent: msg.author.role === "assistant" ? "agent-chatgpt" : null,
        content: [{ type: "text", text }],
      };
      events.push(event);
      thisEventParent = eventId;
    }

    // Push in reverse so the stack still pops children in chronological
    // order, matching the original depth-first recursive traversal.
    const children = [...node.children].sort((a, b) => {
      const ta = mapping[a]?.message?.create_time ?? 0;
      const tb = mapping[b]?.message?.create_time ?? 0;
      return ta - tb;
    });
    for (const childId of children) {
      const child = Object.hasOwn(mapping, childId) ? mapping[childId] : undefined;
      if (!child) throw new Error(`Missing ChatGPT child node "${childId}".`);
      if (child.parent !== nodeId) throw new Error(`Inconsistent ChatGPT parent/child links for "${childId}".`);
    }
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ nodeId: children[i]!, parentEventId: thisEventParent });
    }
  }

  if (events.length === 0) {
    throw new Error("ChatGPT export conversation contained no renderable messages.");
  }

  if (nodeIds.some(id => !visited.has(id))) {
    throw new Error("ChatGPT export contains unreachable nodes (a cycle or inconsistent parent/child links).");
  }

  const record: AirRecord = {
    ...newRecordShell(),
    title: conversation.title ?? "Untitled ChatGPT conversation",
    conversation_created_at: isoFromUnix(conversation.create_time),
    provider: "OpenAI",
    source_uri: opts.sourceUri ?? null,
    capture: newCaptureProvenance("AIR-C2", opts.sourceUri ?? null),
    agents: [
      {
        id: "agent-chatgpt",
        name: "ChatGPT",
        model: { name: null, provider: "OpenAI", evidence: "unknown" },
      },
    ],
    events,
  };

  return { record, warnings: warnings.map((message) => ({ message })) };
}

