import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigStore } from "../../src/config/store.js";
import {
  handleSendMessage,
  handleReadMessages,
  type ToolContext,
} from "../../src/mcp/tools.js";
import { GroupManager } from "../../src/groups/manager.js";
import { S2Client } from "../../src/s2/client.js";
import type { ClawChatMessage } from "../../src/s2/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Message operations", () => {
  let tempDir: string;
  let config: ConfigStore;
  let mockS2: S2Client;
  let ctx: ToolContext;
  const appendedMessages: Array<{ slug: string; message: ClawChatMessage }> = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawchat-msg-test-"));
    config = new ConfigStore(join(tempDir, "config.json"));
    await config.save({
      user: "edgar",
      agent_name: "edgar's openclaw",
      s2_token: "s2_test_token",
      groups: [
        {
          slug: "test-group",
          name: "Test Group",
          streams: ["general"],
          role: "owner",
        },
      ],
    });

    appendedMessages.length = 0;

    mockS2 = {
      appendMessage: vi.fn().mockImplementation(async (slug: string, msg: ClawChatMessage) => {
        appendedMessages.push({ slug, message: msg });
        return { seq_num: appendedMessages.length - 1, timestamp: new Date().toISOString() };
      }),
      readMessages: vi.fn().mockImplementation(async () => ({
        messages: appendedMessages.map((m) => m.message),
        next_seq_num: appendedMessages.length,
      })),
    } as unknown as S2Client;

    const groups = new GroupManager(mockS2, config);
    ctx = { s2: mockS2, groups, config };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("handleSendMessage", () => {
    it("sends a basic message", async () => {
      const result = await handleSendMessage(ctx, {
        group_slug: "test-group",
        content: "Hello from my claw!",
      });

      expect(result.isError).toBeUndefined();
      expect(mockS2.appendMessage).toHaveBeenCalledOnce();

      const sentMsg = appendedMessages[0].message;
      expect(sentMsg.schema_version).toBe(1);
      expect(sentMsg.type).toBe("message");
      expect(sentMsg.content).toBe("Hello from my claw!");
      expect(sentMsg.from.user).toBe("edgar");
      expect(sentMsg.from.agent).toBe("edgar's openclaw");
      expect(sentMsg.timestamp).toBeTruthy();
    });

    it("sends a bug report", async () => {
      const result = await handleSendMessage(ctx, {
        group_slug: "test-group",
        content: "Found a null pointer in auth flow",
        type: "bug_report",
        metadata: {
          repo: "arlington-labs/webapp",
          file: "src/auth.ts",
          error: "TypeError: Cannot read property 'id' of null",
          severity: "error",
        },
      });

      expect(result.isError).toBeUndefined();
      const sentMsg = appendedMessages[0].message;
      expect(sentMsg.type).toBe("bug_report");
      expect(sentMsg.metadata?.repo).toBe("arlington-labs/webapp");
      expect(sentMsg.metadata?.severity).toBe("error");
    });

    it("sends a prompt report", async () => {
      await handleSendMessage(ctx, {
        group_slug: "test-group",
        content: "The system prompt for code review works better with chain-of-thought",
        type: "prompt_report",
        metadata: {
          tool: "code-review",
        },
      });

      expect(appendedMessages[0].message.type).toBe("prompt_report");
    });

    it("returns error for unknown group", async () => {
      const result = await handleSendMessage(ctx, {
        group_slug: "nonexistent",
        content: "Hello",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Group not found");
    });
  });

  describe("handleReadMessages", () => {
    it("reads messages from a group", async () => {
      // Send some messages first
      await handleSendMessage(ctx, {
        group_slug: "test-group",
        content: "Message 1",
      });
      await handleSendMessage(ctx, {
        group_slug: "test-group",
        content: "Message 2",
      });

      const result = await handleReadMessages(ctx, {
        group_slug: "test-group",
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.messages).toHaveLength(2);
      expect(data.next_seq_num).toBe(2);
    });

    it("returns error for unknown group", async () => {
      const result = await handleReadMessages(ctx, {
        group_slug: "nonexistent",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Group not found");
    });

    it("reads from specific stream", async () => {
      await handleReadMessages(ctx, {
        group_slug: "test-group",
        stream: "bug-reports",
      });

      expect(mockS2.readMessages).toHaveBeenCalledWith(
        "test-group",
        "bug-reports",
        undefined,
        undefined
      );
    });

    it("supports pagination with start_seq", async () => {
      await handleReadMessages(ctx, {
        group_slug: "test-group",
        start_seq: 10,
        limit: 25,
      });

      expect(mockS2.readMessages).toHaveBeenCalledWith(
        "test-group",
        "general",
        10,
        25
      );
    });
  });
});
