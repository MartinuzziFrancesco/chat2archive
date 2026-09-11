import type { AirEvent, AirRecord } from "./model.js";

export interface ArchiveStats {
  messageCount: number;
  branchCount: number;
  attachmentCount: number;
  toolCallCount: number;
  /** ids of message events that start a branch (more than one sibling shares their parent). */
  branchStarts: Set<string>;
}

/**
 * Validates internal consistency of a record's event graph: unique ids and
 * parent references that resolve within the record (or are explicitly
 * null/root). Does not mutate event order or content — import fidelity
 * (§26 of instructions.md) means normalization must not rewrite events.
 */
export function normalizeRecord(record: AirRecord): { warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const event of record.events) {
    if (seen.has(event.id)) {
      throw new Error(`Duplicate event id "${event.id}" in conversation graph.`);
    }
    seen.add(event.id);
  }
  for (const event of record.events) {
    if (event.parent !== null && event.parent !== undefined && !seen.has(event.parent)) {
      warnings.push(`Event "${event.id}" references parent "${event.parent}" which is not in this record.`);
    }
  }
  return { warnings };
}

export function computeStats(events: AirEvent[]): ArchiveStats {
  const childCountByParent = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "message") continue;
    const key = event.parent ?? "__root__";
    childCountByParent.set(key, (childCountByParent.get(key) ?? 0) + 1);
  }
  let branchCount = 0;
  for (const count of childCountByParent.values()) {
    if (count > 1) branchCount += count - 1;
  }
  const branchStarts = new Set<string>();
  for (const event of events) {
    if (event.type !== "message") continue;
    const key = event.parent ?? "__root__";
    if ((childCountByParent.get(key) ?? 0) > 1) branchStarts.add(event.id);
  }

  return {
    messageCount: events.filter((e) => e.type === "message").length,
    branchCount,
    attachmentCount: events.filter((e) => e.type === "attachment").length,
    toolCallCount: events.filter((e) => e.type === "tool_call").length,
    branchStarts,
  };
}

