import { importChatGptExport } from "./chatgpt.js";
import { importClaudeExport } from "./claude.js";
import type { ImportResult } from "../core/model.js";

const SHARE_PATH = /^\/share\/[a-f0-9-]{36}\/?$/i;
const MAX_BYTES = 20 * 1024 * 1024;

// A generic HTTP client identity (Node's default, or none at all) gets
// bot-challenged by both providers' edge protection before a single byte of
// the page is served — this isn't optional hardening, requests fail
// outright without it. `capture_software` in the resulting AIR record still
// records what actually fetched the page; this only affects the HTTP
// request, not what's claimed about the archive's provenance.
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

function validateShareUrl(input: string, hosts: string[], label: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.port || url.username || url.password || !SHARE_PATH.test(url.pathname)) {
    throw new Error(`Use a public ${label} conversation link.`);
  }
  url.search = "";
  url.hash = "";
  return url;
}

export function chatGptShareUrl(input: string): URL {
  return validateShareUrl(input, ["chatgpt.com", "chat.openai.com"], "ChatGPT (https://chatgpt.com/share/…)");
}

export function claudeShareUrl(input: string): URL {
  return validateShareUrl(input, ["claude.ai"], "Claude (https://claude.ai/share/…)");
}

/** The conversation id from a validated Claude share URL's `/share/<id>` or `/share/<id>/` path. */
export function claudeSnapshotId(url: URL): string {
  return url.pathname.replace(/\/$/, "").split("/").pop()!;
}

// Cloudflare Workers' fetch only implements redirect modes "follow" and
// "manual" — "error" (what we actually want: never silently follow a
// redirect to an unvalidated URL) throws at the edge as an unsupported
// option. Use "manual" everywhere instead and reject a redirect response
// ourselves, which is available in both Node and Workers.
export function rejectIfRedirected(response: Response, what: string): void {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new Error(`The ${what} redirected unexpectedly; the link may have moved, expired, or require sign-in.`);
  }
}

/** Reads a fetch Response body as text, refusing anything past MAX_BYTES. */
async function readBodyWithLimit(response: Response, what: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`The ${what} returned an empty response.`);
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error(`The ${what} exceeds the 20 MB import limit.`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  return text;
}

/** Read JSON data from the ChatGPT share page without executing any of its scripts. */
export function importChatGptSharePage(html: string, sourceUri: string): ImportResult {
  const url = chatGptShareUrl(sourceUri).href;
  for (const match of html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g)) {
    const chunk: string = JSON.parse(match[1]!);
    if (!chunk.startsWith("[")) continue;
    const table: unknown[] = JSON.parse(chunk);
    const key = table.indexOf("linear_conversation");
    if (key < 0) continue;
    const container = table.find(value => value && typeof value === "object" && `_${key}` in value) as Record<string, number> | undefined;
    if (!container) continue;
    const cache = new Map<number, unknown>();
    const decode = (index: number, depth = 0): any => {
      if (index === -5) return null;
      if (!Number.isInteger(index) || index < 0 || index >= table.length || depth > 256) {
        throw new Error("Unsupported share-page data reference.");
      }
      if (cache.has(index)) return cache.get(index);
      const value = table[index];
      if (Array.isArray(value)) {
        const result: unknown[] = [];
        cache.set(index, result);
        for (const ref of value) result.push(typeof ref === "number" ? decode(ref, depth + 1) : ref);
        return result;
      }
      if (value && typeof value === "object") {
        const result = Object.create(null);
        cache.set(index, result);
        for (const [key, ref] of Object.entries(value)) {
          result[String(decode(Number(key.slice(1)), depth + 1))] = decode(ref as number, depth + 1);
        }
        return result;
      }
      return value;
    };
    const nodes = decode(container[`_${key}`]!);
    if (!Array.isArray(nodes) || nodes.length === 0) continue;
    const mapping = Object.fromEntries(nodes.map(node => [node.id, { ...node, children: node.children ?? [] }]));
    const titleKey = table.indexOf("title");
    const titleRef = container[`_${titleKey}`];
    const imported = importChatGptExport({ mapping, title: titleRef === undefined ? "Shared ChatGPT conversation" : decode(titleRef) }, { sourceUri: url });
    return markAsPublicShare(imported);
  }
  throw new Error("No conversation data found in this share page. The link may be unavailable, require sign-in, or use an unsupported page format.");
}

function markAsPublicShare(imported: ImportResult): ImportResult {
  imported.record.capture.class = "AIR-C1";
  imported.warnings.push({
    message: "Captured the conversation exposed by the public share page. Private branches and content omitted by the provider are not included.",
  });
  return imported;
}

async function fetchChatGptShare(input: string): Promise<ImportResult> {
  const url = chatGptShareUrl(input);
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: FETCH_HEADERS });
  rejectIfRedirected(response, "share page");
  if (!response.ok) throw new Error(`The share page returned HTTP ${response.status}. Check that the link is public and still available.`);
  const html = await readBodyWithLimit(response, "share page");
  return importChatGptSharePage(html, url.href);
}

interface ClaudeSnapshot {
  conversation_uuid: string;
  snapshot_name?: string;
  created_at?: string;
  chat_messages: unknown[];
}

/**
 * Claude's share page is a client-rendered shell: it doesn't embed the
 * conversation, it calls this JSON API after load (see the page's own
 * bootstrap script, which prefetches exactly this URL). A cold request to
 * the API alone hits Cloudflare's bot challenge; loading the share page
 * first and carrying its `__cf_bm` cookie forward — the same two requests
 * a real browser makes — gets a clean response. No user credentials are
 * involved; a non-public or expired link still fails with 401/403.
 */
async function fetchClaudeShare(input: string): Promise<ImportResult> {
  const url = claudeShareUrl(input);
  const id = claudeSnapshotId(url);

  const pageResponse = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: FETCH_HEADERS });
  rejectIfRedirected(pageResponse, "share page");
  if (!pageResponse.ok) throw new Error(`The share page returned HTTP ${pageResponse.status}. Check that the link is public and still available.`);
  await pageResponse.body?.cancel();
  const cfCookie = extractCfBmCookie(pageResponse.headers);

  const apiUrl = new URL(`/api/chat_snapshots/${id}`, url);
  apiUrl.searchParams.set("rendering_mode", "messages");
  apiUrl.searchParams.set("render_all_tools", "true");
  const apiResponse = await fetch(apiUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: { ...FETCH_HEADERS, Accept: "application/json", ...(cfCookie ? { Cookie: cfCookie } : {}) },
  });
  rejectIfRedirected(apiResponse, "share API");
  if (apiResponse.status === 401 || apiResponse.status === 403) {
    throw new Error("This conversation isn't public, or the link has expired.");
  }
  if (!apiResponse.ok) throw new Error(`The share API returned HTTP ${apiResponse.status}.`);

  const text = await readBodyWithLimit(apiResponse, "share API response");
  return importClaudeSnapshot(text, url.href);
}

/** Interprets a claude.ai /api/chat_snapshots/<id> JSON response (as raw text). */
export function importClaudeSnapshot(json: string, sourceUri: string): ImportResult {
  const url = claudeShareUrl(sourceUri).href;
  let data: ClaudeSnapshot;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("The share API returned an unexpected response.");
  }
  if (!Array.isArray(data.chat_messages) || data.chat_messages.length === 0) {
    throw new Error("No messages found in this shared conversation.");
  }
  const imported = importClaudeExport(
    { uuid: data.conversation_uuid, name: data.snapshot_name, created_at: data.created_at, chat_messages: data.chat_messages },
    { sourceUri: url }
  );
  return markAsPublicShare(imported);
}

function extractCfBmCookie(headers: Headers): string | undefined {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
  for (const cookie of raw) {
    const match = /(?:^|,\s*)(__cf_bm=[^;,]+)/.exec(cookie);
    if (match) return match[1];
  }
  return undefined;
}

/** Fetches and imports a public ChatGPT or Claude share link. */
export async function fetchShare(input: string): Promise<ImportResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (["chatgpt.com", "chat.openai.com"].includes(url.hostname)) return fetchChatGptShare(input);
  if (url.hostname === "claude.ai") return fetchClaudeShare(input);
  throw new Error("Use a public ChatGPT (https://chatgpt.com/share/…) or Claude (https://claude.ai/share/…) conversation link.");
}
