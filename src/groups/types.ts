export type GroupRole = "owner" | "member";

export interface GroupConfig {
  slug: string;
  name: string;
  streams: string[];
  role: GroupRole;
}

export interface ClawChatConfig {
  user: string;
  agent_name: string;
  s2_token: string;
  groups: GroupConfig[];
}

export interface InvitePayload {
  slug: string;
  name: string;
  s2_token: string;
  streams: string[];
}

export function basinName(slug: string): string {
  return `clawchat-${slug}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
