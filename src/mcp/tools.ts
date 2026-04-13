import type { S2Client } from "../s2/client.js";
import type { GroupManager } from "../groups/manager.js";
import type { ConfigStore } from "../config/store.js";
import type { MessageType, MessageMetadata, ClawChatMessage } from "../s2/types.js";
import { DEFAULT_STREAM, streamForType } from "../s2/types.js";

export interface ToolContext {
  s2: S2Client;
  groups: GroupManager;
  config: ConfigStore;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function handleCreateGroup(
  ctx: ToolContext,
  args: { name: string; slug?: string }
): Promise<ToolResult> {
  try {
    const result = await ctx.groups.createGroup(args.name, args.slug);
    return ok(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already exists") || msg.includes("conflict")) {
      return err(`Group already exists. Choose a different name or slug.`);
    }
    return err(`Failed to create group: ${msg}`);
  }
}

export async function handleSendMessage(
  ctx: ToolContext,
  args: {
    group_slug: string;
    content: string;
    type?: MessageType;
    metadata?: MessageMetadata;
  }
): Promise<ToolResult> {
  try {
    const group = await ctx.config.getGroup(args.group_slug);
    if (!group) {
      return err("Group not found. Check your group slug.");
    }

    const identity = await ctx.config.getIdentity();
    const msgType = args.type ?? "message";

    const message: ClawChatMessage = {
      schema_version: 1,
      type: msgType,
      from: {
        user: identity.user,
        agent: identity.agent,
      },
      content: args.content,
      timestamp: new Date().toISOString(),
      ...(args.metadata && { metadata: args.metadata }),
    };

    const result = await ctx.s2.appendMessage(args.group_slug, message);

    // Track new streams in config
    const stream = streamForType(msgType);
    await ctx.config.addStreamToGroup(args.group_slug, stream);

    return ok(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("auth") || msg.includes("token") || msg.includes("401")) {
      return err(
        "Authentication failed. Run clawchat_join with a fresh invite token."
      );
    }
    return err(`Failed to send message: ${msg}`);
  }
}

export async function handleReadMessages(
  ctx: ToolContext,
  args: {
    group_slug: string;
    stream?: string;
    start_seq?: number;
    limit?: number;
  }
): Promise<ToolResult> {
  try {
    const group = await ctx.config.getGroup(args.group_slug);
    if (!group) {
      return err("Group not found. Check your group slug.");
    }

    const streamName = args.stream ?? DEFAULT_STREAM;
    const result = await ctx.s2.readMessages(
      args.group_slug,
      streamName,
      args.start_seq,
      args.limit
    );
    return ok(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found") || msg.includes("404")) {
      return err("Group not found. Check your group slug.");
    }
    return err(`Failed to read messages: ${msg}`);
  }
}

export async function handleListGroups(ctx: ToolContext): Promise<ToolResult> {
  try {
    const groups = await ctx.groups.listGroups();
    return ok(
      groups.map((g) => ({
        slug: g.slug,
        name: g.name,
        streams: g.streams,
        role: g.role,
      }))
    );
  } catch (e: unknown) {
    return err(`Failed to list groups: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleInvite(
  ctx: ToolContext,
  args: { group_slug: string; invitee_user: string }
): Promise<ToolResult> {
  try {
    const token = await ctx.groups.generateInvite(args.group_slug);
    return ok({
      invite_token: token,
      instructions: `Share this token with ${args.invitee_user}. They should call clawchat_join with it.`,
    });
  } catch (e: unknown) {
    return err(`Failed to generate invite: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleJoin(
  ctx: ToolContext,
  args: { invite_token: string }
): Promise<ToolResult> {
  try {
    const result = await ctx.groups.joinGroup(args.invite_token);
    return ok(result);
  } catch (e: unknown) {
    return err(`Failed to join group: ${e instanceof Error ? e.message : String(e)}`);
  }
}
