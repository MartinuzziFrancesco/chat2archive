// Canonical AIR (AI Interaction Record) data model — AIR 0.1.
// See docs/AIR-0.1.md for the normative specification.

export type Role = "user" | "assistant" | "system" | "tool";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface AttachmentRefBlock {
  type: "attachment_ref";
  attachment_id: string;
}

export type ContentBlock = TextBlock | AttachmentRefBlock;

export interface BaseEvent {
  id: string;
  type: string;
  parent?: string | null;
  timestamp?: string | null;
}

export interface MessageEvent extends BaseEvent {
  type: "message";
  role: Role;
  agent?: string | null;
  content: ContentBlock[];
}

export interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  tool: string;
  arguments?: unknown;
  arguments_available: boolean;
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  tool_call: string;
  result?: unknown;
  result_available: boolean;
}

export interface AttachmentEvent extends BaseEvent {
  type: "attachment";
  filename: string;
  media_type?: string | null;
  path?: string | null;
  external_uri?: string | null;
}

export interface GeneratedFileEvent extends BaseEvent {
  type: "generated_file";
  filename: string;
  media_type?: string | null;
  path?: string | null;
}

export interface CitationEvent extends BaseEvent {
  type: "citation";
  uri?: string | null;
  title?: string | null;
}

export interface EditEvent extends BaseEvent {
  type: "edit";
  edited_event: string;
}

export interface RegenerationEvent extends BaseEvent {
  type: "regeneration";
  original_event: string;
}

export interface BranchEvent extends BaseEvent {
  type: "branch";
  label?: string | null;
}

export interface SystemEventRecord extends BaseEvent {
  type: "system_event";
  label: string;
  detail?: string | null;
}

export type AirEvent =
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | AttachmentEvent
  | GeneratedFileEvent
  | CitationEvent
  | EditEvent
  | RegenerationEvent
  | BranchEvent
  | SystemEventRecord;

export type Evidence =
  | "api_response"
  | "provider_export"
  | "displayed_in_ui"
  | "share_page"
  | "user_reported"
  | "inferred"
  | "unknown";

export interface ModelInfo {
  name: string | null;
  provider: string | null;
  evidence: Evidence;
}

export interface AgentInfo {
  id: string;
  name: string | null;
  model: ModelInfo;
}

export type CaptureClass = "AIR-C0" | "AIR-C1" | "AIR-C2" | "AIR-C3" | "AIR-C4";

export interface CaptureProvenance {
  class: CaptureClass;
  source_uri: string | null;
  captured_at: string;
  capture_software: string;
}

export interface Creator {
  name: string;
  orcid?: string | null;
}

export interface RelatedRecord {
  relation:
    | "continuedFrom"
    | "isVersionOf"
    | "hasVersion"
    | "isDerivedFrom"
    | "isSourceOf"
    | "relatedPublication";
  identifier: string;
}

/**
 * In-memory canonical representation of one AI interaction, before it is
 * rendered into the files of an AIR package (air.json + conversation.jsonl
 * + generated documentation).
 */
export interface AirRecord {
  air_version: "0.1";
  title: string;
  creator: Creator[];
  conversation_created_at: string | null;
  capture_created_at: string;
  provider: string | null;
  source_uri: string | null;
  license: string | null;
  keywords: string[];
  description: string | null;
  selection: "full" | "branch" | "excerpt";
  capture: CaptureProvenance;
  agents: AgentInfo[];
  events: AirEvent[];
  related: RelatedRecord[];
  /** Present only after canonical hashing has been performed. */
  canonical_sha256?: string;
}

export interface ImportWarning {
  message: string;
}

export interface ImportResult {
  record: AirRecord;
  warnings: ImportWarning[];
}
