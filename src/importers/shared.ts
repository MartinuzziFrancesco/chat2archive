import type { AirRecord, CaptureClass, CaptureProvenance } from "../core/model.js";

export const CAPTURE_SOFTWARE = "chat2archive/0.1.0";

export function newCaptureProvenance(cls: CaptureClass, sourceUri: string | null): CaptureProvenance {
  return {
    class: cls,
    source_uri: sourceUri,
    captured_at: new Date().toISOString(),
    capture_software: CAPTURE_SOFTWARE,
  };
}

/** Fields every importer must fill in themselves are intentionally left as defaults here. */
export function newRecordShell(): Omit<AirRecord, "capture" | "events" | "agents" | "title"> {
  return {
    air_version: "0.1",
    creator: [],
    conversation_created_at: null,
    capture_created_at: new Date().toISOString(),
    provider: null,
    source_uri: null,
    license: null,
    keywords: [],
    description: null,
    selection: "full",
    related: [],
  };
}
