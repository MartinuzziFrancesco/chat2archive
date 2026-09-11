import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importAny } from "../src/importers/detect.js";
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

test("rejects JSON that matches neither known export shape", () => {
  assert.throws(() => importAny(JSON.stringify({ some: "random", shape: true })), /does not match a recognized/);
});

test("fails explicitly on an empty conversations.json mapping instead of guessing", () => {
  assert.throws(() =>
    importAny(JSON.stringify([{ title: "x", mapping: {} }]))
  );
});
