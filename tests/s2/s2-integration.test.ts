import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { S2Client } from "../../test-harness/s2/client.js";
import { streamForType, type AgentChatMessage, type MessageType } from "../../test-harness/s2/types.js";

const S2_ACCESS_TOKEN = process.env.S2_ACCESS_TOKEN;
const TEST_SLUG = `int-test-${Date.now()}`;

describe.skipIf(!S2_ACCESS_TOKEN)("S2 Integration Tests", () => {
  let client: S2Client;

  beforeAll(() => {
    client = new S2Client(S2_ACCESS_TOKEN!);
  });

  afterAll(async () => {
    if (!S2_ACCESS_TOKEN) return;
    try {
      await client.deleteBasin(TEST_SLUG);
    } catch {
      // Basin may not exist if creation failed — that's fine
    }
  }, 30_000);

  // ── Basin lifecycle ──────────────────────────────────────────────

  describe("basin lifecycle", () => {
    it("creates a basin", async () => {
      const basin = await client.createBasin(TEST_SLUG);
      expect(basin.name).toBe(`agentchat-${TEST_SLUG}`);
    }, 15_000);

    it("lists basins and finds the test basin", async () => {
      const basins = await client.listBasins(`agentchat-${TEST_SLUG}`);
      const found = basins.some((b) => b.name === `agentchat-${TEST_SLUG}`);
      expect(found).toBe(true);
    }, 15_000);
  });

  // ── Stream creation ──────────────────────────────────────────────

  describe("stream creation", () => {
    it("creates typed streams", async () => {
      // Create bug-reports and prompt-reports explicitly
      await client.createStream(TEST_SLUG, "bug-reports");
      await client.createStream(TEST_SLUG, "prompt-reports");

      const streams = await client.listStreams(TEST_SLUG);
      const names = streams.map((s) => s.name);

      // general was created via createStreamOnAppend or explicitly
      expect(names).toContain("bug-reports");
      expect(names).toContain("prompt-reports");
    }, 15_000);
  });

  // ── Message append + read round-trip ─────────────────────────────

  describe("message round-trip", () => {
    const sentMessages: AgentChatMessage[] = [];

    it("appends a chat message to general stream", async () => {
      const msg = makeMessage("message", "Hello from integration test");
      const ack = await client.appendMessage(TEST_SLUG, msg);

      expect(ack.seq_num).toBeTypeOf("number");
      expect(ack.timestamp).toBeTruthy();
      sentMessages.push(msg);
    }, 15_000);

    it("appends a bug_report to bug-reports stream", async () => {
      const msg = makeMessage("bug_report", "Null pointer in auth flow", {
        repo: "arlington-labs/webapp",
        file: "src/auth.ts",
        error: "TypeError: Cannot read property 'id' of null",
        severity: "error",
      });
      const ack = await client.appendMessage(TEST_SLUG, msg);

      expect(ack.seq_num).toBeTypeOf("number");
      sentMessages.push(msg);
    }, 15_000);

    it("appends a prompt_report to prompt-reports stream", async () => {
      const msg = makeMessage("prompt_report", "Chain-of-thought improves code review", {
        tool: "code-review",
      });
      const ack = await client.appendMessage(TEST_SLUG, msg);

      expect(ack.seq_num).toBeTypeOf("number");
      sentMessages.push(msg);
    }, 15_000);

    it("appends a dx_feedback to general stream", async () => {
      const msg = makeMessage("dx_feedback", "SDK error messages could be clearer");
      const ack = await client.appendMessage(TEST_SLUG, msg);

      expect(ack.seq_num).toBeTypeOf("number");
      sentMessages.push(msg);
    }, 15_000);

    it("reads back chat messages from general stream", async () => {
      const result = await client.readMessages(TEST_SLUG, "general");

      expect(result.messages.length).toBeGreaterThanOrEqual(2);
      expect(result.next_seq_num).toBeGreaterThan(0);

      // Verify the first general message content
      const chatMsg = result.messages.find((m) => m.type === "message");
      expect(chatMsg).toBeDefined();
      expect(chatMsg!.content).toBe("Hello from integration test");
      expect(chatMsg!.schema_version).toBe(1);
      expect(chatMsg!.from.user).toBe("test-user");
      expect(chatMsg!.from.agent).toBe("test-agent");
    }, 15_000);

    it("reads back bug reports from bug-reports stream", async () => {
      const result = await client.readMessages(TEST_SLUG, "bug-reports");

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      const bugMsg = result.messages.find((m) => m.type === "bug_report");
      expect(bugMsg).toBeDefined();
      expect(bugMsg!.content).toBe("Null pointer in auth flow");
      expect(bugMsg!.metadata?.repo).toBe("arlington-labs/webapp");
      expect(bugMsg!.metadata?.severity).toBe("error");
    }, 15_000);

    it("reads back prompt reports from prompt-reports stream", async () => {
      const result = await client.readMessages(TEST_SLUG, "prompt-reports");

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      const promptMsg = result.messages.find((m) => m.type === "prompt_report");
      expect(promptMsg).toBeDefined();
      expect(promptMsg!.metadata?.tool).toBe("code-review");
    }, 15_000);
  });

  // ── Message ordering ─────────────────────────────────────────────

  describe("message ordering", () => {
    it("preserves append order within a stream", async () => {
      const messages = [
        makeMessage("message", "Order test 1"),
        makeMessage("message", "Order test 2"),
        makeMessage("message", "Order test 3"),
      ];

      const acks = [];
      for (const msg of messages) {
        acks.push(await client.appendMessage(TEST_SLUG, msg));
      }

      // Seq nums must be strictly increasing
      for (let i = 1; i < acks.length; i++) {
        expect(acks[i].seq_num).toBeGreaterThan(acks[i - 1].seq_num);
      }

      // Read back and verify order
      const result = await client.readMessages(TEST_SLUG, "general", acks[0].seq_num, 3);
      expect(result.messages.length).toBe(3);
      expect(result.messages[0].content).toBe("Order test 1");
      expect(result.messages[1].content).toBe("Order test 2");
      expect(result.messages[2].content).toBe("Order test 3");
    }, 30_000);
  });

  // ── Pagination (start_seq + limit) ──────────────────────────────

  describe("pagination", () => {
    it("reads a subset using start_seq and limit", async () => {
      // Read only 2 messages from the general stream starting at seq 0
      const result = await client.readMessages(TEST_SLUG, "general", 0, 2);

      expect(result.messages.length).toBe(2);
      expect(result.next_seq_num).toBeGreaterThan(0);
    }, 15_000);

    it("continues reading from next_seq_num", async () => {
      const first = await client.readMessages(TEST_SLUG, "general", 0, 2);
      const second = await client.readMessages(TEST_SLUG, "general", first.next_seq_num, 2);

      // Second batch should not overlap with first
      expect(second.messages.length).toBeGreaterThanOrEqual(1);
      if (first.messages.length > 0 && second.messages.length > 0) {
        expect(second.messages[0].content).not.toBe(first.messages[0].content);
      }
    }, 15_000);
  });

  // ── Schema correctness ──────────────────────────────────────────

  describe("schema correctness", () => {
    it("all messages have schema_version 1", async () => {
      const result = await client.readMessages(TEST_SLUG, "general");
      for (const msg of result.messages) {
        expect(msg.schema_version).toBe(1);
      }
    }, 15_000);

    it("all messages have valid from fields", async () => {
      const result = await client.readMessages(TEST_SLUG, "general");
      for (const msg of result.messages) {
        expect(msg.from).toBeDefined();
        expect(msg.from.user).toBeTruthy();
        expect(msg.from.agent).toBeTruthy();
      }
    }, 15_000);

    it("all messages have valid timestamps", async () => {
      const result = await client.readMessages(TEST_SLUG, "general");
      for (const msg of result.messages) {
        expect(msg.timestamp).toBeTruthy();
        const parsed = new Date(msg.timestamp);
        expect(parsed.getTime()).not.toBeNaN();
      }
    }, 15_000);

    it("message routing matches streamForType", async () => {
      // Verify that bug_report → bug-reports, prompt_report → prompt-reports
      expect(streamForType("bug_report")).toBe("bug-reports");
      expect(streamForType("prompt_report")).toBe("prompt-reports");
      expect(streamForType("message")).toBe("general");
      expect(streamForType("dx_feedback")).toBe("general");
    });
  });

  // ── Full group lifecycle ────────────────────────────────────────

  describe("full group lifecycle", () => {
    const lifecycleSlug = `int-lifecycle-${Date.now()}`;

    afterAll(async () => {
      if (!S2_ACCESS_TOKEN) return;
      try {
        await client.deleteBasin(lifecycleSlug);
      } catch {
        // cleanup best-effort
      }
    }, 30_000);

    it("create group → send message → read messages", async () => {
      // 1. Create basin (simulates group creation)
      const basin = await client.createBasin(lifecycleSlug);
      expect(basin.name).toBe(`agentchat-${lifecycleSlug}`);

      // 2. Create general stream
      await client.createStream(lifecycleSlug, "general");

      // 3. Send a message
      const msg = makeMessage("message", "First message in lifecycle test");
      const ack = await client.appendMessage(lifecycleSlug, msg);
      expect(ack.seq_num).toBeTypeOf("number");

      // 4. Read it back
      const result = await client.readMessages(lifecycleSlug, "general");
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].content).toBe("First message in lifecycle test");
      expect(result.messages[0].schema_version).toBe(1);
      expect(result.next_seq_num).toBeGreaterThan(0);
    }, 30_000);
  });

  // ── Scoped access tokens ───────────────────────────────────────

  describe("scoped access tokens", () => {
    const scopedSlug = `int-scoped-${Date.now()}`;

    afterAll(async () => {
      if (!S2_ACCESS_TOKEN) return;
      try {
        await client.deleteBasin(scopedSlug);
      } catch {
        // cleanup best-effort
      }
    }, 30_000);

    it("issues a scoped token that can read and append", async () => {
      // Owner creates basin and general stream
      await client.createBasin(scopedSlug);
      await client.createStream(scopedSlug, "general");

      // Owner issues scoped token
      const scopedToken = await client.issueAccessToken(scopedSlug, [
        "read",
        "append",
      ]);
      expect(scopedToken).toBeTruthy();

      // Member uses scoped token
      const memberClient = new S2Client(scopedToken);

      // Member can append
      const msg = makeMessage("message", "Hello from scoped token");
      const ack = await memberClient.appendMessage(scopedSlug, msg);
      expect(ack.seq_num).toBeTypeOf("number");

      // Member can read
      const result = await memberClient.readMessages(scopedSlug, "general");
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      const found = result.messages.find(
        (m) => m.content === "Hello from scoped token"
      );
      expect(found).toBeDefined();
    }, 30_000);

    it("scoped token cannot create basins", async () => {
      const scopedToken = await client.issueAccessToken(scopedSlug, [
        "read",
        "append",
      ]);
      const memberClient = new S2Client(scopedToken);

      await expect(
        memberClient.createBasin(`int-unauthorized-${Date.now()}`)
      ).rejects.toThrow();
    }, 15_000);
  });
});

// ── Helpers ──────────────────────────────────────────────────────

function makeMessage(
  type: MessageType,
  content: string,
  metadata?: AgentChatMessage["metadata"]
): AgentChatMessage {
  return {
    schema_version: 1,
    type,
    from: { user: "test-user", agent: "test-agent" },
    content,
    metadata,
    timestamp: new Date().toISOString(),
  };
}
