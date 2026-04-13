import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigStore } from "../../test-harness/config/store.js";
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
        name: "agentchat-test-group",
        state: "active",
      }),
      deleteBasin: vi.fn().mockResolvedValue(undefined),
      createStream: vi.fn().mockResolvedValue(undefined),
      listStreams: vi.fn().mockResolvedValue([]),
    })),
  };
});

describe("GroupManager", () => {
  let tempDir: string;
  let config: ConfigStore;
  let s2: S2Client;
  let manager: GroupManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentchat-groups-test-"));
    config = new ConfigStore(join(tempDir, "config.json"));
    await config.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test_token",
      groups: [],
    });
    s2 = new S2Client("s2_test_token");
    manager = new GroupManager(s2, config);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("createGroup", () => {
    it("creates a group with basin and general stream", async () => {
      const result = await manager.createGroup("Test Group", "test-group");

      expect(result.slug).toBe("test-group");
      expect(result.basin).toBe("agentchat-test-group");
      expect(result.streams).toContain("general");
      expect(s2.createBasin).toHaveBeenCalledWith("test-group");
      expect(s2.createStream).toHaveBeenCalledWith("test-group", "general");
    });

    it("auto-generates slug from name", async () => {
      const result = await manager.createGroup("Garry and Friends");

      expect(result.slug).toBe("garry-and-friends");
      expect(result.basin).toBe("agentchat-garry-and-friends");
    });

    it("saves group to config as owner", async () => {
      await manager.createGroup("Test Group", "test-group");

      const group = await config.getGroup("test-group");
      expect(group).toBeDefined();
      expect(group!.role).toBe("owner");
      expect(group!.name).toBe("Test Group");
    });
  });

  describe("listGroups", () => {
    it("returns groups from config", async () => {
      await manager.createGroup("Group A", "group-a");
      await manager.createGroup("Group B", "group-b");

      const groups = await manager.listGroups();
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.slug)).toEqual(["group-a", "group-b"]);
    });
  });

  describe("invite/join flow", () => {
    it("generates and accepts invite tokens", async () => {
      // Create group as owner
      await manager.createGroup("Friends", "friends");

      // Generate invite
      const token = await manager.generateInvite("friends");
      expect(token).toBeTruthy();

      // Decode and verify token structure
      const decoded = JSON.parse(
        Buffer.from(token, "base64url").toString("utf-8")
      );
      expect(decoded.slug).toBe("friends");
      expect(decoded.s2_token).toBeUndefined();
      expect(decoded.streams).toContain("general");
      expect(decoded.expires_at).toBeTruthy();
      // Verify expiry is ~7 days from now
      const expiry = new Date(decoded.expires_at);
      const sixDays = Date.now() + 6 * 24 * 60 * 60 * 1000;
      const eightDays = Date.now() + 8 * 24 * 60 * 60 * 1000;
      expect(expiry.getTime()).toBeGreaterThan(sixDays);
      expect(expiry.getTime()).toBeLessThan(eightDays);

      // Join as a new user (using a separate config)
      const joinerDir = await mkdtemp(join(tmpdir(), "agentchat-joiner-"));
      const joinerConfig = new ConfigStore(join(joinerDir, "config.json"));
      await joinerConfig.save({
        user: "floyd",
        agent_name: "floyd's openclaw",
        s2_token: "",
        groups: [],
      });

      const joinerManager = new GroupManager(
        new S2Client("dummy"),
        joinerConfig
      );
      const joinResult = await joinerManager.joinGroup(token);

      expect(joinResult.group_slug).toBe("friends");
      expect(joinResult.basin).toBe("agentchat-friends");
      expect(joinResult.streams).toContain("general");

      // Verify joiner config was updated
      const joinerGroup = await joinerConfig.getGroup("friends");
      expect(joinerGroup).toBeDefined();
      expect(joinerGroup!.role).toBe("member");

      // Verify S2 token was NOT saved from invite (no longer in payload)
      const joinerFullConfig = await joinerConfig.load();
      expect(joinerFullConfig.s2_token).toBe("");

      await rm(joinerDir, { recursive: true, force: true });
    });

    it("rejects invites from non-owners", async () => {
      // Add a group as member
      await config.addGroup({
        slug: "someone-elses",
        name: "Someone's Group",
        streams: ["general"],
        role: "member",
      });

      await expect(
        manager.generateInvite("someone-elses")
      ).rejects.toThrow("Only group owners can generate invites");
    });

    it("rejects invalid invite tokens", async () => {
      await expect(
        manager.joinGroup("not-valid-base64!!!")
      ).rejects.toThrow();
    });

    it("rejects expired invite tokens", async () => {
      const expiredPayload = {
        slug: "friends",
        name: "Friends",
        streams: ["general"],
        expires_at: new Date(Date.now() - 1000).toISOString(),
      };
      const token = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");

      await expect(manager.joinGroup(token)).rejects.toThrow("expired");
    });
  });

  describe("slug validation", () => {
    it("rejects slugs with uppercase letters", async () => {
      await expect(
        manager.createGroup("Test", "INVALID")
      ).rejects.toThrow("Slug must be 2-63 chars");
    });

    it("rejects single-character slugs", async () => {
      await expect(
        manager.createGroup("Test", "a")
      ).rejects.toThrow("Slug must be 2-63 chars");
    });

    it("rejects slugs starting with hyphens", async () => {
      await expect(
        manager.createGroup("Test", "-bad-slug")
      ).rejects.toThrow("Slug must be 2-63 chars");
    });

    it("rejects slugs with special characters", async () => {
      await expect(
        manager.createGroup("Test", "bad_slug!")
      ).rejects.toThrow("Slug must be 2-63 chars");
    });

    it("accepts valid slugs", async () => {
      const result = await manager.createGroup("Test", "valid-slug-123");
      expect(result.slug).toBe("valid-slug-123");
    });

    it("rejects invalid slugs in invite tokens", async () => {
      const payload = {
        slug: "INVALID",
        name: "Bad",
        streams: ["general"],
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
      await expect(manager.joinGroup(token)).rejects.toThrow("Slug must be 2-63 chars");
    });
  });
});
