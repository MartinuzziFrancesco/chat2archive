// INTERACTION.md generator — a concise interaction datasheet, in the
// tradition of Datasheets for Datasets (Gebru et al.). Every section is
// auto-populated from what was actually observed; freeform sections stay
// short placeholders when the user supplies nothing, rather than being
// invented (§13, §26 of instructions.md).

import type { AirRecord } from "./model.js";
import { computeStats } from "./normalize.js";

export interface DatasheetNotes {
  motivation?: string;
  intendedUse?: string;
  ethicsPrivacy?: string;
  limitations?: string;
  externalMaterial?: string;
}

export function renderInteractionMarkdown(record: AirRecord, notes: DatasheetNotes = {}): string {
  const stats = computeStats(record.events);
  const modelDescriptions = record.agents
    .map((a) => `- **${a.name ?? a.id}** — model: ${a.model.name ?? "unknown"} (provider: ${a.model.provider ?? "unknown"}, evidence: ${a.model.evidence})`)
    .join("\n");

  const participants =
    record.creator.length > 0
      ? record.creator.map((c) => `- ${c.name}${c.orcid ? ` (ORCID: ${c.orcid})` : ""}`).join("\n")
      : "- Not supplied. This archive does not record the identity of the human participant(s).";

  const selectionLine =
    {
      full: "This record is the complete source conversation as observed at capture time.",
      branch: "This record represents one branch of a larger conversation graph.",
      excerpt: "This record is an excerpt of a larger source conversation.",
    }[record.selection] ?? "Unspecified.";

  return `# INTERACTION.md — ${record.title}

An interaction datasheet for this AIR record, describing the circumstances
under which it was captured. Adapted from the *Datasheets for Datasets*
methodology (Gebru et al., 2018) for AI conversation records.

## Motivation

${notes.motivation ?? "Not supplied by the person who created this archive."}

## Participants

${participants}

## System

- Provider: ${record.provider ?? "unknown"}
- Source: ${record.source_uri ?? "not recorded"}
${modelDescriptions || "- No agent/model information was captured."}

Model identity above reflects only what was directly observed or exported;
see the \`evidence\` field on each agent for how it was determined. This
archive cannot attest to hidden system prompts, provider-side routing,
sampling configuration, or safety-classifier behavior.

## Interaction conditions

Not independently verifiable from the source data available to \`chat2archive\`.
Whether browsing, tools, custom instructions, memory, or project context were
active is only as observable as the export/source exposes it; tool
invocations recorded in \`conversation.jsonl\` (if any) are the only direct
evidence of tool use in this record.

## Selection

${selectionLine}

## Modification

None. \`chat2archive\` does not rewrite, correct, summarize, or otherwise alter
message content during normalization (see the project's fidelity rules).

## External material

${notes.externalMaterial ?? `${stats.attachmentCount} attachment(s) referenced in this record; see \`attachments/\` and \`conversation.jsonl\` for details.`}

## Intended use

${notes.intendedUse ?? "Not supplied by the person who created this archive."}

## Limitations

${notes.limitations ?? "No additional limitations supplied."} This archive
represents an *observed* interaction, not a reproducible execution: it does
not capture hidden provider state (system prompts, model weights, inference
seeds, undisclosed preprocessing).

## Ethics and privacy

${notes.ethicsPrivacy ?? "Not reviewed for personal, confidential, or third-party material by chat2archive. The person creating this archive is responsible for that review before publication."}

## Maintenance and versioning

This is an immutable snapshot captured at ${record.capture.captured_at}. A
continued or follow-up conversation should be archived as a separate AIR
record and linked via a \`relatedPublication\`/\`continuedFrom\` relationship,
not by editing this one.
${record.related.length > 0 ? `\nRelated records:\n${record.related.map((r) => `- ${r.relation}: ${r.identifier}`).join("\n")}` : ""}
`;
}
