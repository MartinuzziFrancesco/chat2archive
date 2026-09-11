import { test } from "node:test";
import assert from "node:assert/strict";
import { importChatGptSharePage, importClaudeSnapshot, chatGptShareUrl, claudeShareUrl, fetchShare } from "../src/importers/share.js";
import { buildPackage, zipPackage } from "../src/core/package.js";
import { filesFromZip, validatePackageFiles } from "../src/core/validate.js";

const chatGptUrl = "https://chatgpt.com/share/6aa2da3d-e2f0-83eb-b342-df597a32749a";
// Synthetic share-page wire data: two turns, with a newline and HTML-like text.
const table = [
  { _1: 2, _3: 4 }, "title", "Shared example", "linear_conversation", [5, 6],
  { _7: 8, _9: 10, _11: -5, _12: 13 },
  { _7: 14, _9: 15, _11: 8, _12: 16 },
  "id", "user-node", "message", { _7: 8, _17: 18, _19: 20 },
  "parent", "children", [14], "assistant-node", { _7: 14, _17: 21, _19: 22 }, [],
  "author", { _23: 24 }, "content", { _25: 26 }, { _23: 27 }, { _25: 28 },
  "role", "user", "parts", [29], "assistant", [30], "Hello\n<example>", "Hello back",
];
const page = `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(table) + "\n")});</script>`;

test("ChatGPT share-page import preserves message text and records public-share provenance", async () => {
  const result = importChatGptSharePage(page, chatGptUrl);
  assert.equal(result.record.title, "Shared example");
  assert.equal(result.record.capture.class, "AIR-C1");
  assert.equal(result.record.source_uri, chatGptUrl);
  assert.deepEqual(result.record.events.map(event => event.type === "message" && event.content), [
    [{ type: "text", text: "Hello\n<example>" }], [{ type: "text", text: "Hello back" }],
  ]);
  assert.equal(result.record.events[1]?.parent, result.record.events[0]?.id);
  const built = await buildPackage(result.record);
  assert.equal((await validatePackageFiles(filesFromZip(zipPackage(built)))).valid, true);
});

test("ChatGPT share importer rejects app shells and challenge pages instead of archiving HTML", () => {
  assert.throws(() => importChatGptSharePage("<html><body>Please sign in</body></html>", chatGptUrl), /No conversation data/);
});

test("fetch only allows HTTPS public ChatGPT or Claude share URLs", async () => {
  for (const input of [
    "http://chatgpt.com/share/" + "a".repeat(36),
    "https://localhost/",
    "https://chatgpt.com.evil.test/share/" + "a".repeat(36),
    "https://chatgpt.com/backend-api/me",
    chatGptUrl.replace("chatgpt.com", "user:pass@chatgpt.com"),
    chatGptUrl.replace("chatgpt.com", "chatgpt.com:8080"),
    "https://claude.ai.evil.test/share/" + "a".repeat(36),
    "https://claude.ai/chat/" + "a".repeat(36),
    "not a url",
  ]) {
    await assert.rejects(fetchShare(input));
  }
  assert.equal(chatGptShareUrl(chatGptUrl + "?tracking=1#fragment").href, chatGptUrl);
});

const claudeUrl = "https://claude.ai/share/077c2a1f-16a9-409a-b376-6b002689d007";
// Synthetic snapshot shaped like the real claude.ai/api/chat_snapshots/<id>
// response: linear, with a tool call/result pair and a real parent chain
// (the root sentinel matches what the live API uses).
const ROOT = "00000000-0000-4000-8000-000000000000";
const snapshot = JSON.stringify({
  conversation_uuid: "conv-example",
  snapshot_name: "Example shared chat",
  created_at: "2026-09-10T09:32:58.086169Z",
  chat_messages: [
    {
      uuid: "m1", sender: "human", parent_message_uuid: ROOT,
      content: [{ type: "text", text: "What's a tourelle?" }],
    },
    {
      uuid: "m2", sender: "assistant", parent_message_uuid: "m1",
      content: [
        { type: "text", text: "A small corner turret." },
        { type: "tool_use", id: "tu1", name: "web_search", input: { query: "tourelle paris" } },
        { type: "tool_result", tool_use_id: "tu1", content: "3 results" },
        { type: "text", text: "Here's what I found." },
      ],
    },
  ],
});

test("Claude share-snapshot import preserves messages, tool calls, and real parent links", async () => {
  const result = importClaudeSnapshot(snapshot, claudeUrl);
  assert.equal(result.record.title, "Example shared chat");
  assert.equal(result.record.provider, "Anthropic");
  assert.equal(result.record.capture.class, "AIR-C1");
  assert.equal(result.record.source_uri, claudeUrl);
  assert.deepEqual(
    result.record.events.map(e => e.type),
    ["message", "message", "tool_call", "tool_result", "message"]
  );
  const [m1, m2] = result.record.events;
  assert.equal(m1?.parent, null);
  assert.equal(m2?.parent, m1?.id);
  const built = await buildPackage(result.record);
  assert.equal((await validatePackageFiles(filesFromZip(zipPackage(built)))).valid, true);
});

test("Claude snapshot importer rejects an empty or malformed response", () => {
  assert.throws(() => importClaudeSnapshot("{not json", claudeUrl), /unexpected response/);
  assert.throws(() => importClaudeSnapshot(JSON.stringify({ chat_messages: [] }), claudeUrl), /No messages/);
});

test("claudeShareUrl strips tracking params and validates the path", () => {
  assert.equal(claudeShareUrl(claudeUrl + "?x=1#y").href, claudeUrl);
  assert.throws(() => claudeShareUrl("https://claude.ai/chat/" + "a".repeat(36)));
});
