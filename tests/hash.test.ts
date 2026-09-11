import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJsonStringify, canonicalEventsJsonl, sha256HexOfString } from "../src/core/hash.js";

test("canonicalJsonStringify sorts object keys but preserves array order", () => {
  const a = canonicalJsonStringify({ b: 1, a: [3, 2, 1], c: { z: 1, y: 2 } });
  assert.equal(a, '{"a":[3,2,1],"b":1,"c":{"y":2,"z":1}}');
});

test("canonicalJsonStringify is stable regardless of input key order", () => {
  const a = canonicalJsonStringify({ x: 1, y: 2 });
  const b = canonicalJsonStringify({ y: 2, x: 1 });
  assert.equal(a, b);
});

test("canonicalEventsJsonl hash is deterministic across repeated calls", async () => {
  const events = [{ id: "e1", type: "message", role: "user" }];
  const jsonl1 = canonicalEventsJsonl(events);
  const jsonl2 = canonicalEventsJsonl(events.map((e) => ({ ...e })));
  assert.equal(jsonl1, jsonl2);
  const h1 = await sha256HexOfString(jsonl1);
  const h2 = await sha256HexOfString(jsonl2);
  assert.equal(h1, h2);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test("canonicalEventsJsonl hash changes if array order changes", async () => {
  const e1 = { id: "e1", type: "message" };
  const e2 = { id: "e2", type: "message" };
  const h1 = await sha256HexOfString(canonicalEventsJsonl([e1, e2]));
  const h2 = await sha256HexOfString(canonicalEventsJsonl([e2, e1]));
  assert.notEqual(h1, h2);
});
