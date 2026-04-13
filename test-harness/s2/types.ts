export type MessageType = "message" | "bug_report" | "prompt_report" | "dx_feedback";

export interface AgentChatMessage {
  schema_version: 1;
  type: MessageType;
  from: {
    user: string;
    agent: string;
  };
  content: string;
  metadata?: MessageMetadata;
  timestamp: string;
}

export interface MessageMetadata {
  repo?: string;
  file?: string;
  error?: string;
  tool?: string;
  severity?: "info" | "warning" | "error";
}

export interface ReadMessagesResult {
  messages: AgentChatMessage[];
  next_seq_num: number;
}

export const STREAM_ROUTES: Record<string, string> = {
  bug_report: "bug-reports",
  prompt_report: "prompt-reports",
};

export const DEFAULT_STREAM = "general";

export function streamForType(type: MessageType): string {
  return STREAM_ROUTES[type] ?? DEFAULT_STREAM;
}
