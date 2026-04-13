import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { S2Client } from "../s2/client.js";
import { GroupManager } from "../groups/manager.js";
import { ConfigStore } from "../config/store.js";
import {
  handleCreateGroup,
  handleSendMessage,
  handleReadMessages,
  handleListGroups,
  handleInvite,
  handleJoin,
  type ToolContext,
} from "./tools.js";

export function createServer(configPath?: string): McpServer {
  const config = new ConfigStore(configPath);

  const server = new McpServer({
    name: "agentchat",
    version: "0.3.0",
  });

  // Lazy-initialize S2 client and group manager on first tool call
  let ctx: ToolContext | null = null;

  async function getContext(): Promise<ToolContext> {
    if (ctx) return ctx;
    const token = process.env.S2_TOKEN || (await config.getS2Token());
    if (!token) {
      throw new Error(
        "No S2 token configured. Set S2_TOKEN env var, set s2_token in ~/.agentchat/config.json, or join a group with agentchat_join."
      );
    }
    const s2 = new S2Client(token);
    const groups = new GroupManager(s2, config);
    ctx = { s2, groups, config };
    return ctx;
  }

  // --- Tool: agentchat_create_group ---
  server.tool(
    "agentchat_create_group",
    "Create a new private group chat. Creates an S2 basin and default 'general' stream.",
    {
      name: z.string().describe("Human-readable group name"),
      slug: z
        .string()
        .optional()
        .describe("URL-safe group identifier (auto-generated from name if omitted)"),
    },
    async ({ name, slug }) => {
      const c = await getContext();
      return handleCreateGroup(c, { name, slug });
    }
  );

  // --- Tool: agentchat_send_message ---
  server.tool(
    "agentchat_send_message",
    "Send a message to a group. Routes by type: bug_report → bug-reports stream, prompt_report → prompt-reports stream, others → general.",
    {
      group_slug: z.string().describe("Group slug to send the message to"),
      content: z.string().describe("Message content"),
      type: z
        .enum(["message", "bug_report", "prompt_report", "dx_feedback"])
        .optional()
        .describe("Message type (default: message)"),
      metadata: z
        .object({
          repo: z.string().optional(),
          file: z.string().optional(),
          error: z.string().optional(),
          tool: z.string().optional(),
          severity: z.enum(["info", "warning", "error"]).optional(),
        })
        .optional()
        .describe("Optional metadata for structured reports"),
    },
    async ({ group_slug, content, type, metadata }) => {
      const c = await getContext();
      return handleSendMessage(c, { group_slug, content, type, metadata });
    }
  );

  // --- Tool: agentchat_read_messages ---
  server.tool(
    "agentchat_read_messages",
    "Read messages from a group. Returns last N messages. Use start_seq to paginate forward.",
    {
      group_slug: z.string().describe("Group slug to read from"),
      stream: z
        .string()
        .optional()
        .describe("Stream name (default: general). Options: general, bug-reports, prompt-reports"),
      start_seq: z
        .number()
        .optional()
        .describe("Start reading from this sequence number (for pagination)"),
      limit: z
        .number()
        .optional()
        .describe("Max messages to return (default: 50)"),
    },
    async ({ group_slug, stream, start_seq, limit }) => {
      const c = await getContext();
      return handleReadMessages(c, { group_slug, stream, start_seq, limit });
    }
  );

  // --- Tool: agentchat_list_groups ---
  server.tool(
    "agentchat_list_groups",
    "List all groups you belong to.",
    {},
    async () => {
      const c = await getContext();
      return handleListGroups(c);
    }
  );

  // --- Tool: agentchat_invite ---
  server.tool(
    "agentchat_invite",
    "Generate an invite token for a group. Share the token out-of-band (DM, email) with the invitee.",
    {
      group_slug: z.string().describe("Group to invite to"),
      invitee_user: z
        .string()
        .describe("Username of the person being invited (for reference)"),
    },
    async ({ group_slug, invitee_user }) => {
      const c = await getContext();
      return handleInvite(c, { group_slug, invitee_user });
    }
  );

  // --- Tool: agentchat_join ---
  server.tool(
    "agentchat_join",
    "Join a group using an invite token. Writes group credentials to local config.",
    {
      invite_token: z.string().describe("Invite token received from another user"),
    },
    async ({ invite_token }) => {
      const c = await getContext();
      return handleJoin(c, { invite_token });
    }
  );

  return server;
}
