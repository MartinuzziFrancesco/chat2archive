import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { importAny } from "../src/importers/detect.js";
import { importChatGptExport } from "../src/importers/chatgpt.js";
import { importClaudeExport } from "../src/importers/claude.js";
import { importGenericTranscript } from "../src/importers/generic.js";
import { computeStats } from "../src/core/normalize.js";
import type { MessageEvent } from "../src/core/model.js";

test("detects and imports a ChatGPT export, preserving branches", () => {
  const raw = readFileSync("fixtures/chatgpt/branching.json", "utf-8");
  const result = importAny(raw);
  assert.equal(result.detected, "chatgpt_export");
  assert.equal(result.record.provider, "OpenAI");

  const stats = computeStats(result.record.events);
  assert.equal(stats.messageCount, 6);
  assert.equal(stats.branchCount, 1, "one node has two children => one branch");

  const messages = result.record.events.filter((e): e is MessageEvent => e.type === "message");
  const root = messages.find((m) => m.parent === null);
  assert.ok(root);
  assert.equal(root!.role, "user");
});

test("rejects a ChatGPT export where every node has a parent (a pure cycle)", () => {
  const mapping = {
    a: { id: "a", parent: "b", children: ["b"] },
    b: { id: "b", parent: "a", children: ["a"] },
  };
  assert.throws(() => importChatGptExport({ title: "cycle", mapping }), /no root node/);
});

test("rejects a ChatGPT export graph with a cycle below the root instead of hanging or crashing", () => {
  const mapping = {
    r: { id: "r", parent: null, children: ["a"] },
    a: { id: "a", parent: "r", children: ["b"] },
    b: { id: "b", parent: "a", children: ["a"] },
  };
  assert.throws(() => importChatGptExport({ title: "cycle", mapping }), /reachable more than once/);
});

test("warns about ChatGPT export nodes disconnected from the main conversation instead of dropping them silently", () => {
  const mapping = {
    root: {
      id: "root",
      parent: null,
      children: ["child"],
      message: { id: "m-root", author: { role: "user" }, content: { content_type: "text", text: "hi" } },
    },
    child: {
      id: "child",
      parent: "root",
      children: [],
      message: { id: "m-child", author: { role: "assistant" }, content: { content_type: "text", text: "hello" } },
    },
    orphan: {
      id: "orphan",
      parent: null,
      children: [],
      message: { id: "m-orphan", author: { role: "user" }, content: { content_type: "text", text: "stray" } },
    },
  };
  const result = importChatGptExport({ title: "disconnected", mapping });
  assert.equal(result.record.events.length, 2);
  assert.ok(result.warnings.some((w) => w.message.includes("1 node(s)")));
});

test("imports a Claude export as a flat parent chain with tool_use/tool_result", () => {
  const raw = readFileSync("fixtures/claude/simple.json", "utf-8");
  const result = importAny(raw);
  assert.equal(result.detected, "claude_export");
  assert.equal(result.record.provider, "Anthropic");

  const types = result.record.events.map((e) => e.type);
  assert.ok(types.includes("tool_call"));
  assert.ok(types.includes("tool_result"));

  // No two message events should share the same parent (Claude exports carry no branch info).
  const messageParents = result.record.events
    .filter((e) => e.type === "message")
    .map((e) => e.parent ?? "__root__");
  assert.equal(new Set(messageParents).size, messageParents.length);
});

test("resolves Claude parent_message_uuid independent of message array order", () => {
  const ROOT = "00000000-0000-4000-8000-000000000000";
  const result = importClaudeExport({
    uuid: "conv",
    name: "Out of order",
    chat_messages: [
      // Child appears before its parent in the array.
      { uuid: "b", sender: "assistant", parent_message_uuid: "a", content: [{ type: "text", text: "reply" }] },
      { uuid: "a", sender: "human", parent_message_uuid: ROOT, content: [{ type: "text", text: "hello" }] },
    ],
  });
  const [b, a] = result.record.events as MessageEvent[];
  assert.equal(a?.parent, null);
  assert.equal(b?.parent, a?.id);
});

test("diagnoses an unresolved Claude parent instead of inventing a relationship", () => {
  const result = importClaudeExport({
    uuid: "conv",
    name: "Broken parent link",
    chat_messages: [
      { uuid: "a", sender: "human", parent_message_uuid: "00000000-0000-4000-8000-000000000000", content: [{ type: "text", text: "hello" }] },
      { uuid: "b", sender: "assistant", parent_message_uuid: "does-not-exist", content: [{ type: "text", text: "reply" }] },
    ],
  });
  const [a, b] = result.record.events as MessageEvent[];
  assert.equal(a?.parent, null);
  assert.equal(b?.parent, null, "an unresolved parent must not silently fall back to the previous event");
  assert.ok(result.warnings.some((w) => w.message.includes("does-not-exist")));
});

test("warns about Claude content blocks it cannot yet represent instead of dropping them silently", () => {
  const result = importClaudeExport({
    uuid: "conv",
    name: "Has an image block",
    chat_messages: [
      {
        uuid: "a",
        sender: "human",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", source: { type: "base64", data: "..." } } as never,
        ],
      },
    ],
  });
  assert.equal(result.record.events.length, 1);
  assert.ok(result.warnings.some((w) => w.message.includes('"image"') && w.message.includes("omitted")));
});

test("imports a plain pasted transcript with role-labeled lines", () => {
  const text = readFileSync("fixtures/generic/simple.txt", "utf-8");
  const result = importAny(text);
  assert.equal(result.detected, "generic_transcript");
  assert.equal(result.record.capture.class, "AIR-C0");

  const messages = result.record.events.filter((e): e is MessageEvent => e.type === "message");
  assert.equal(messages.length, 4);
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant"]
  );
});

test("preserves indentation on the first/last line of a pasted message", () => {
  const text = "User:\n    def foo():\n        pass\nAssistant: ok\n";
  const result = importGenericTranscript(text);
  const [first] = result.record.events as MessageEvent[];
  const textContent = first?.content[0];
  assert.equal(textContent?.type === "text" ? textContent.text : undefined, "    def foo():\n        pass");
});

test("warns when a ZIP export contains files beyond conversations.json", () => {
  const conversations = readFileSync("fixtures/chatgpt/branching.json", "utf-8");
  const zip = zipSync({
    "conversations.json": new TextEncoder().encode(conversations),
    "user.json": new TextEncoder().encode("{}"),
    "chat.html": new TextEncoder().encode("<html></html>"),
  });
  const result = importAny(zip);
  assert.equal(result.detected, "chatgpt_export");
  assert.ok(
    result.warnings.some((w) => w.message.includes("2 additional file(s)")),
    `expected a discarded-files warning, got: ${JSON.stringify(result.warnings)}`
  );
});

test("rejects JSON that matches neither known export shape", () => {
  assert.throws(() => importAny(JSON.stringify({ some: "random", shape: true })), /does not match a recognized/);
});

test("fails explicitly on an empty conversations.json mapping instead of guessing", () => {
  assert.throws(() =>
    importAny(JSON.stringify([{ title: "x", mapping: {} }]))
  );
});
