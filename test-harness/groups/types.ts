export type GroupRole = "owner" | "member";

export interface GroupConfig {
  slug: string;
  name: string;
  streams: string[];
  role: GroupRole;
}

export interface AgentChatConfig {
  user: string;
  agent_name: string;
  s2_token: string;
  groups: GroupConfig[];
}

export interface InvitePayload {
  slug: string;
  name: string;
  streams: string[];
  expires_at: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      "Slug must be 2-63 chars, lowercase alphanumeric and hyphens only"
    );
  }
}

export function basinName(slug: string): string {
  return `agentchat-${slug}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
