import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigStore } from "../../test-harness/config/store.js";
import {
  handleCreateGroup,
  handleListGroups,
  handleInvite,
  handleJoin,
  type ToolContext,
} from "../../test-harness/mcp/tools.js";
import { GroupManager } from "../../test-harness/groups/manager.js";
import { S2Client } from "../../test-harness/s2/client.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock S2Client
vi.mock("../../test-harness/s2/client.js", () => {
  return {
    S2Client: vi.fn().mockImplementation(() => ({
      createBasin: vi.fn().mockResolvedValue({
        name: "agentchat-test",
        state: "active",
      }),
      deleteBasin: vi.fn().mockResolvedValue(undefined),
      createStream: vi.fn().mockResolvedValue(undefined),
      listStreams: vi.fn().mockResolvedValue([]),
      appendMessage: vi.fn().mockResolvedValue({
        seq_num: 0,
        timestamp: new Date().toISOString(),
      }),
      readMessages: vi.fn().mockResolvedValue({
        messages: [],
        next_seq_num: 0,
      }),
    })),
  };
});

describe("MCP Tool Handlers", () => {
  let tempDir: string;
  let config: ConfigStore;
  let ctx: ToolContext;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentchat-mcp-test-"));
    config = new ConfigStore(join(tempDir, "config.json"));
    await config.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test_token",
      groups: [],
    });
    const s2 = new S2Client("s2_test_token");
    const groups = new GroupManager(s2, config);
    ctx = { s2, groups, config };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("agentchat_create_group", () => {
    it("creates a group and returns slug, basin, streams", async () => {
      const result = await handleCreateGroup(ctx, { name: "Friends" });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.slug).toBe("friends");
      expect(data.basin).toBe("agentchat-friends");
      expect(data.streams).toContain("general");
    });

    it("accepts custom slug", async () => {
      const result = await handleCreateGroup(ctx, {
        name: "The Cool Kids",
        slug: "cool-kids",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.slug).toBe("cool-kids");
    });
  });

  describe("agentchat_list_groups", () => {
    it("lists all configured groups", async () => {
      await handleCreateGroup(ctx, { name: "Group A", slug: "group-a" });
      await handleCreateGroup(ctx, { name: "Group B", slug: "group-b" });

      const result = await handleListGroups(ctx);
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
      expect(data[0].slug).toBe("group-a");
      expect(data[1].slug).toBe("group-b");
    });

    it("returns empty array when no groups", async () => {
      const result = await handleListGroups(ctx);
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual([]);
    });
  });

  describe("agentchat_invite + agentchat_join", () => {
    it("full invite/join flow through MCP tools", async () => {
      // Create group
      await handleCreateGroup(ctx, { name: "Alpha Team", slug: "alpha-team" });

      // Generate invite
      const inviteResult = await handleInvite(ctx, {
        group_slug: "alpha-team",
        invitee_user: "floyd",
      });
      expect(inviteResult.isError).toBeUndefined();
      const inviteData = JSON.parse(inviteResult.content[0].text);
      expect(inviteData.invite_token).toBeTruthy();

      // Set up joiner context — joiner must have their own S2 token (not from invite)
      const joinerDir = await mkdtemp(join(tmpdir(), "agentchat-joiner-mcp-"));
      const joinerConfig = new ConfigStore(join(joinerDir, "config.json"));
      await joinerConfig.save({
        user: "floyd",
        agent_name: "floyd's openclaw",
        s2_token: "s2_test_token",
        groups: [],
      });
      const joinerS2 = new S2Client("dummy");
      const joinerGroups = new GroupManager(joinerS2, joinerConfig);
      const joinerCtx: ToolContext = {
        s2: joinerS2,
        groups: joinerGroups,
        config: joinerConfig,
      };

      // Join
      const joinResult = await handleJoin(joinerCtx, {
        invite_token: inviteData.invite_token,
      });
      expect(joinResult.isError).toBeUndefined();
      const joinData = JSON.parse(joinResult.content[0].text);
      expect(joinData.group_slug).toBe("alpha-team");
      expect(joinData.basin).toBe("agentchat-alpha-team");

      // Verify joiner has the group
      const joinerGroupsList = await handleListGroups(joinerCtx);
      const joinerGroupsData = JSON.parse(joinerGroupsList.content[0].text);
      expect(joinerGroupsData).toHaveLength(1);
      expect(joinerGroupsData[0].slug).toBe("alpha-team");

      await rm(joinerDir, { recursive: true, force: true });
    });

    it("returns error for non-existent group invite", async () => {
      const result = await handleInvite(ctx, {
        group_slug: "nonexistent",
        invitee_user: "someone",
      });
      expect(result.isError).toBe(true);
    });

    it("returns error for invalid invite token", async () => {
      const result = await handleJoin(ctx, {
        invite_token: "totally-invalid-token",
      });
      expect(result.isError).toBe(true);
    });
  });
});
