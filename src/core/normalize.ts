import type { AirEvent, AirRecord } from "./model.js";

export interface ArchiveStats {
  messageCount: number;
  branchCount: number;
  attachmentCount: number;
  toolCallCount: number;
  /** ids of events that start a branch (more than one sibling shares their parent). */
  branchStarts: Set<string>;
}

/**
 * Validates internal consistency of a record's event graph: unique ids and
 * parent references that resolve within the record (or are explicitly
 * null/root), acyclic parent chains, and exposed event references.
 * Does not mutate event order or content — import fidelity
 * (§26 of instructions.md) means normalization must not rewrite events.
 */
export function normalizeRecord(record: AirRecord): { warnings: string[] } {
  const errors = validateEventGraph(record.events);
  if (errors.length) throw new Error(errors.join("; "));
  return { warnings: [] };
}

/** Check references without requiring fields that the source did not expose. */
export function validateEventGraph(events: AirEvent[]): string[] {
  const errors: string[] = [];
  const byId = new Map<string, AirEvent>();
  for (const event of events) {
    if (byId.has(event.id)) errors.push(`Duplicate event id "${event.id}".`);
    byId.set(event.id, event);
  }
  const reference = (event: AirEvent, id: unknown, targetType?: string) => {
    if (id === undefined || id === null) return;
    const target = typeof id === "string" ? byId.get(id) : undefined;
    if (!target || (targetType && target.type !== targetType)) {
      errors.push(`Event "${event.id}" has an unresolved or invalid reference "${String(id)}"${targetType ? ` (expected ${targetType})` : ""}.`);
    }
  };
  for (const event of events) {
    reference(event, event.parent);
    if (event.type === "tool_result") reference(event, event.tool_call, "tool_call");
    if (event.type === "edit") reference(event, event.edited_event);
    if (event.type === "regeneration") reference(event, event.original_event);
    if (event.type === "message" && Array.isArray(event.content)) {
      for (const block of event.content) {
        if (block && block.type === "attachment_ref") reference(event, block.attachment_id, "attachment");
      }
    }
  }
  const done = new Set<string>();
  for (const event of events) {
    const path = new Set<string>();
    let current: AirEvent | undefined = event;
    while (current && !done.has(current.id)) {
      if (path.has(current.id)) {
        errors.push(`Cycle in parent references at event "${current.id}".`);
        break;
      }
      path.add(current.id);
      current = current.parent == null ? undefined : byId.get(current.parent);
    }
    for (const id of path) done.add(id);
  }
  return errors;
}

export function computeStats(events: AirEvent[]): ArchiveStats {
  const childCountByParent = new Map<string, number>();
  for (const event of events) {
    if (event.parent == null) continue;
    const key = event.parent;
    childCountByParent.set(key, (childCountByParent.get(key) ?? 0) + 1);
  }
  let branchCount = 0;
  for (const count of childCountByParent.values()) {
    if (count > 1) branchCount += count - 1;
  }
  const branchStarts = new Set<string>();
  for (const event of events) {
    if (event.parent == null) continue;
    const key = event.parent;
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

