import type { AirEvent, AirRecord } from "./model.js";
import type { ArchiveStats } from "./normalize.js";

function agentName(record: AirRecord, agentId?: string | null): string | null {
  if (!agentId) return null;
  return record.agents.find((a) => a.id === agentId)?.name ?? agentId;
}

function eventText(event: AirEvent): string {
  if (event.type !== "message") return "";
  return event.content
    .map((c) => (c.type === "text" ? c.text : `[attachment: ${c.attachment_id}]`))
    .join("\n");
}

function roleLabel(role: string): string {
  return { user: "User", assistant: "Assistant", system: "System", tool: "Tool" }[role] ?? role;
}

export function renderTranscriptMarkdown(record: AirRecord, stats: ArchiveStats): string {
  const branchStarts = stats.branchStarts;
  const lines: string[] = [];

  lines.push(`# ${record.title}`);
  lines.push("");
  lines.push(`- Provider: ${record.provider ?? "unknown"}`);
  lines.push(`- Conversation created: ${record.conversation_created_at ?? "unknown"}`);
  lines.push(`- Capture class: ${record.capture.class}`);
  lines.push(`- Messages: ${stats.messageCount} · Branches: ${stats.branchCount} · Tool calls: ${stats.toolCallCount} · Attachments: ${stats.attachmentCount}`);
  if (record.agents.length > 0) {
    lines.push(
      `- Agents: ${record.agents
        .map((a) => `${a.name ?? a.id} (model: ${a.model.name ?? "unknown"}, evidence: ${a.model.evidence})`)
        .join("; ")}`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const event of record.events) {
    switch (event.type) {
      case "message": {
        if (branchStarts.has(event.id)) lines.push("_↳ branch point_");
        const who = event.role === "assistant" ? agentName(record, event.agent) ?? roleLabel(event.role) : roleLabel(event.role);
        lines.push(`**${who}**${event.timestamp ? ` — ${event.timestamp}` : ""}`);
        lines.push("");
        lines.push(eventText(event));
        lines.push("");
        break;
      }
      case "tool_call":
        lines.push(`> 🔧 tool call: \`${event.tool}\`${event.arguments_available ? "" : " (arguments not captured)"}`);
        lines.push("");
        break;
      case "tool_result":
        lines.push(`> 🔧 tool result${event.result_available ? "" : " (result not captured)"}`);
        lines.push("");
        break;
      case "attachment":
        lines.push(`> 📎 attachment: ${event.filename}${event.path ? ` (\`${event.path}\`)` : ""}`);
        lines.push("");
        break;
      case "generated_file":
        lines.push(`> 🗎 generated file: ${event.filename}${event.path ? ` (\`${event.path}\`)` : ""}`);
        lines.push("");
        break;
      case "citation":
        lines.push(`> 🔗 citation: ${event.title ?? event.uri ?? "unknown"}${event.uri ? ` — ${event.uri}` : ""}`);
        lines.push("");
        break;
      case "edit":
        lines.push(`> ✎ edit of \`${event.edited_event}\``);
        lines.push("");
        break;
      case "regeneration":
        lines.push(`> ↻ regeneration of \`${event.original_event}\``);
        lines.push("");
        break;
      case "branch":
        lines.push(`> ⑂ branch${event.label ? `: ${event.label}` : ""}`);
        lines.push("");
        break;
      case "system_event":
        lines.push(`> ⚙ ${event.label}${event.detail ? `: ${event.detail}` : ""}`);
        lines.push("");
        break;
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `Captured ${record.capture.captured_at} via ${record.capture.capture_software} · Capture class ${record.capture.class}` +
      (record.capture.source_uri ? ` · Source: ${record.capture.source_uri}` : "")
  );
  lines.push("");
  lines.push(
    "This is a human-readable rendering, not the authoritative record. The authoritative record is `conversation.jsonl`."
  );

  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HTML_STYLE = `
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; background: #fff; }
header { border-bottom: 1px solid #ddd; margin-bottom: 1.5rem; padding-bottom: 1rem; }
header p { color: #555; font-size: 0.9rem; }
.turn { margin-bottom: 1.25rem; }
.turn .who { font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.02em; color: #444; }
.turn .when { color: #888; font-size: 0.8rem; margin-left: 0.5rem; }
.turn .text { white-space: pre-wrap; margin-top: 0.25rem; }
.turn.user .text { background: #f4f4f4; padding: 0.75rem; border-radius: 6px; }
.turn.assistant .text { padding: 0 0.1rem; }
.marker { color: #888; font-size: 0.85rem; margin: 0.5rem 0; }
.branch-point { color: #a15c00; font-size: 0.8rem; margin-bottom: 0.25rem; }
footer { border-top: 1px solid #ddd; margin-top: 2rem; padding-top: 1rem; color: #666; font-size: 0.8rem; }
`;

export function renderTranscriptHtml(record: AirRecord, stats: ArchiveStats): string {
  const branchStarts = stats.branchStarts;
  const body: string[] = [];

  for (const event of record.events) {
    switch (event.type) {
      case "message": {
        const who = event.role === "assistant" ? agentName(record, event.agent) ?? roleLabel(event.role) : roleLabel(event.role);
        body.push(`<div class="turn ${escapeHtml(event.role)}">`);
        if (branchStarts.has(event.id)) body.push(`<div class="branch-point">↳ branch point</div>`);
        body.push(
          `<div class="who">${escapeHtml(who)}${event.timestamp ? `<span class="when">${escapeHtml(event.timestamp)}</span>` : ""}</div>`
        );
        body.push(`<div class="text">${escapeHtml(eventText(event))}</div>`);
        body.push(`</div>`);
        break;
      }
      case "tool_call":
        body.push(
          `<div class="marker">🔧 tool call: <code>${escapeHtml(event.tool)}</code>${event.arguments_available ? "" : " (arguments not captured)"}</div>`
        );
        break;
      case "tool_result":
        body.push(`<div class="marker">🔧 tool result${event.result_available ? "" : " (result not captured)"}</div>`);
        break;
      case "attachment":
        body.push(`<div class="marker">📎 attachment: ${escapeHtml(event.filename)}</div>`);
        break;
      case "generated_file":
        body.push(`<div class="marker">🗎 generated file: ${escapeHtml(event.filename)}</div>`);
        break;
      case "citation":
        body.push(
          `<div class="marker">🔗 citation: ${escapeHtml(event.title ?? event.uri ?? "unknown")}</div>`
        );
        break;
      case "edit":
        body.push(`<div class="marker">✎ edit of <code>${escapeHtml(event.edited_event)}</code></div>`);
        break;
      case "regeneration":
        body.push(`<div class="marker">↻ regeneration of <code>${escapeHtml(event.original_event)}</code></div>`);
        break;
      case "branch":
        body.push(`<div class="marker">⑂ branch${event.label ? `: ${escapeHtml(event.label)}` : ""}</div>`);
        break;
      case "system_event":
        body.push(`<div class="marker">⚙ ${escapeHtml(event.label)}</div>`);
        break;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(record.title)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(record.title)}</h1>
<p>Provider: ${escapeHtml(record.provider ?? "unknown")} · Messages: ${stats.messageCount} · Branches: ${stats.branchCount} · Capture class: ${escapeHtml(record.capture.class)}</p>
</header>
<main>
${body.join("\n")}
</main>
<footer>
Captured ${escapeHtml(record.capture.captured_at)} via ${escapeHtml(record.capture.capture_software)} · Capture class ${escapeHtml(record.capture.class)}${record.capture.source_uri ? ` · Source: ${escapeHtml(record.capture.source_uri)}` : ""}
<br>This is a human-readable rendering, not the authoritative record. The authoritative record is <code>conversation.jsonl</code>.
</footer>
</body>
</html>
`;
}
