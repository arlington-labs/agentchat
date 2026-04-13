import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigStore } from "../../src/config/store.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigStore", () => {
  let tempDir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentchat-test-"));
    store = new ConfigStore(join(tempDir, "config.json"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns default config when file doesn't exist", async () => {
    const config = await store.load();
    expect(config).toEqual({
      user: "",
      agent_name: "",
      s2_token: "",
      groups: [],
    });
  });

  it("saves and loads config", async () => {
    await store.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test_token",
      groups: [],
    });

    const loaded = await store.load();
    expect(loaded.user).toBe("edgar");
    expect(loaded.s2_token).toBe("s2_test_token");
  });

  it("adds a group", async () => {
    await store.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test",
      groups: [],
    });

    await store.addGroup({
      slug: "test-group",
      name: "Test Group",
      streams: ["general"],
      role: "owner",
    });

    const group = await store.getGroup("test-group");
    expect(group).toBeDefined();
    expect(group!.slug).toBe("test-group");
    expect(group!.role).toBe("owner");
  });

  it("updates existing group on re-add", async () => {
    await store.save({
      user: "test",
      agent_name: "test",
      s2_token: "s2_test",
      groups: [
        { slug: "my-group", name: "My Group", streams: ["general"], role: "owner" },
      ],
    });

    await store.addGroup({
      slug: "my-group",
      name: "My Group Updated",
      streams: ["general", "bug-reports"],
      role: "owner",
    });

    const config = await store.load();
    expect(config.groups).toHaveLength(1);
    expect(config.groups[0].name).toBe("My Group Updated");
    expect(config.groups[0].streams).toContain("bug-reports");
  });

  it("adds stream to group", async () => {
    await store.save({
      user: "test",
      agent_name: "test",
      s2_token: "s2_test",
      groups: [
        { slug: "my-group", name: "My Group", streams: ["general"], role: "owner" },
      ],
    });

    await store.addStreamToGroup("my-group", "bug-reports");

    const group = await store.getGroup("my-group");
    expect(group!.streams).toContain("bug-reports");
  });

  it("does not duplicate streams", async () => {
    await store.save({
      user: "test",
      agent_name: "test",
      s2_token: "s2_test",
      groups: [
        { slug: "my-group", name: "My Group", streams: ["general"], role: "owner" },
      ],
    });

    await store.addStreamToGroup("my-group", "general");

    const group = await store.getGroup("my-group");
    expect(group!.streams).toEqual(["general"]);
  });

  it("sets file permissions to 0o600 on save", async () => {
    await store.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test",
      groups: [],
    });

    const stats = await stat(join(tempDir, "config.json"));
    // 0o600 = owner read+write only (octal 33024 on macOS = 0o100600)
    const perms = stats.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it("returns identity", async () => {
    await store.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test",
      groups: [],
    });

    const id = await store.getIdentity();
    expect(id.user).toBe("edgar");
    expect(id.agent).toBe("edgar's openclaw");
  });
});
