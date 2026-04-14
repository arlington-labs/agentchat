import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../test-harness/mcp/server.js";
import { S2Client } from "../../test-harness/s2/client.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const S2_ACCESS_TOKEN = process.env.S2_ACCESS_TOKEN;
const RAND = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ── Agent helper ──────────────────────────────────────────────────

interface Agent {
  client: Client;
  cleanup: () => Promise<void>;
}

async function createAgent(
  user: string,
  agentName: string,
  token: string,
  groups: Array<{
    slug: string;
    name: string;
    role: "owner" | "member";
    s2_access_token?: string;
  }> = []
): Promise<Agent> {
  const tempDir = await mkdtemp(join(tmpdir(), `agentchat-mcp-int-${user}-`));
  const configPath = join(tempDir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        user,
        agent_name: agentName,
        s2_access_token: token,
        groups,
      },
      null,
      2
    )
  );

  const server = createServer(configPath);
  const mcpClient = new Client({ name: `test-${user}`, version: "1.0.0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    client: mcpClient,
    cleanup: async () => {
      await mcpClient.close();
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function callTool(agent: Agent, name: string, args: Record<string, unknown>) {
  return agent.client.callTool({ name, arguments: args });
}

function parseResult(result: Awaited<ReturnType<typeof callTool>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    // Error results are plain text, not JSON
    return { _error: text };
  }
}

function isError(result: Awaited<ReturnType<typeof callTool>>): boolean {
  return (result as { isError?: boolean }).isError === true;
}

// Retry reads with backoff for eventual consistency
async function readWithRetry(
  agent: Agent,
  groupSlug: string,
  opts: { stream?: string; minMessages?: number; retries?: number } = {}
): Promise<{ messages: Array<Record<string, unknown>>; next_seq_num: number }> {
  const { stream, minMessages = 1, retries = 5 } = opts;
  const empty = { messages: [] as Array<Record<string, unknown>>, next_seq_num: 0 };

  for (let i = 0; i < retries; i++) {
    const result = await callTool(agent, "agentchat_read_messages", {
      group_slug: groupSlug,
      ...(stream && { stream }),
    });
    if (isError(result)) {
      // Stream may not exist yet — wait and retry
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      continue;
    }
    const data = parseResult(result) as {
      messages: Array<Record<string, unknown>>;
      next_seq_num: number;
    };
    if (data.messages && data.messages.length >= minMessages) return data;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  // Final attempt
  const result = await callTool(agent, "agentchat_read_messages", {
    group_slug: groupSlug,
    ...(stream && { stream }),
  });
  if (isError(result)) return empty;
  const data = parseResult(result) as {
    messages: Array<Record<string, unknown>>;
    next_seq_num: number;
  };
  return data.messages ? data : empty;
}

// ── Test suites ───────────────────────────────────────────────────

describe.skipIf(!S2_ACCESS_TOKEN)("MCP Integration Tests (real S2)", () => {
  const basinsToCleanup: string[] = [];
  let s2Cleanup: S2Client;

  beforeAll(() => {
    s2Cleanup = new S2Client(S2_ACCESS_TOKEN!);
  });

  afterAll(async () => {
    for (const slug of basinsToCleanup) {
      try {
        await s2Cleanup.deleteBasin(slug);
      } catch {
        console.warn(`Failed to clean up basin: agentchat-${slug}`);
      }
    }
  }, 60_000);

  // ── Test 1: DM between two agents ────────────────────────────

  describe("DM between two agents", () => {
    const slug = `dm-${RAND}`;
    let agentA: Agent;
    let agentB: Agent;

    afterAll(async () => {
      basinsToCleanup.push(slug);
      await Promise.allSettled([agentA?.cleanup(), agentB?.cleanup()]);
    });

    it("full DM flow: create → invite → join → send → read", async () => {
      // Agent A creates group
      agentA = await createAgent("alice", "alice-claw", S2_ACCESS_TOKEN!);
      const createResult = await callTool(agentA, "agentchat_create_group", {
        name: "DM Test",
        slug,
      });
      const createData = parseResult(createResult) as {
        slug: string;
        basin: string;
      };
      expect(createData.slug).toBe(slug);
      expect(createData.basin).toBe(`agentchat-${slug}`);

      // Agent A generates invite
      const inviteResult = await callTool(agentA, "agentchat_invite", {
        group_slug: slug,
        invitee_user: "bob",
      });
      const inviteData = parseResult(inviteResult) as {
        invite_token: string;
      };
      expect(inviteData.invite_token).toBeTruthy();

      // Agent B joins with invite token
      agentB = await createAgent("bob", "bob-claw", S2_ACCESS_TOKEN!);
      const joinResult = await callTool(agentB, "agentchat_join", {
        invite_token: inviteData.invite_token,
      });
      const joinData = parseResult(joinResult) as { group_slug: string };
      expect(joinData.group_slug).toBe(slug);

      // Agent A sends a message
      const sendResult = await callTool(agentA, "agentchat_send_message", {
        group_slug: slug,
        content: "hey B",
      });
      expect((sendResult as { isError?: boolean }).isError).toBeFalsy();

      // Agent B reads and sees the message
      const readData = await readWithRetry(agentB, slug);
      expect(readData.messages.length).toBeGreaterThanOrEqual(1);
      const msg = readData.messages.find(
        (m) => m.content === "hey B"
      );
      expect(msg).toBeDefined();
      expect(msg!.from).toEqual({ user: "alice", agent: "alice-claw" });
    }, 60_000);
  });

  // ── Test 2: Group chat with three agents ─────────────────────

  describe("Group chat with three agents", () => {
    const slug = `group-${RAND}`;
    let agentA: Agent;
    let agentB: Agent;
    let agentC: Agent;

    afterAll(async () => {
      basinsToCleanup.push(slug);
      await Promise.allSettled([
        agentA?.cleanup(),
        agentB?.cleanup(),
        agentC?.cleanup(),
      ]);
    });

    it("three agents communicate in a shared group", async () => {
      // Agent A creates group
      agentA = await createAgent("alice", "alice-claw", S2_ACCESS_TOKEN!);
      await callTool(agentA, "agentchat_create_group", {
        name: "Trio Chat",
        slug,
      });

      // Agent A invites B
      const invB = await callTool(agentA, "agentchat_invite", {
        group_slug: slug,
        invitee_user: "bob",
      });
      const invBData = parseResult(invB) as { invite_token: string };

      // Agent A invites C
      const invC = await callTool(agentA, "agentchat_invite", {
        group_slug: slug,
        invitee_user: "charlie",
      });
      const invCData = parseResult(invC) as { invite_token: string };

      // B and C join
      agentB = await createAgent("bob", "bob-claw", S2_ACCESS_TOKEN!);
      await callTool(agentB, "agentchat_join", {
        invite_token: invBData.invite_token,
      });

      agentC = await createAgent("charlie", "charlie-claw", S2_ACCESS_TOKEN!);
      await callTool(agentC, "agentchat_join", {
        invite_token: invCData.invite_token,
      });

      // All three send messages
      await callTool(agentA, "agentchat_send_message", {
        group_slug: slug,
        content: "hello from alice",
      });
      await callTool(agentB, "agentchat_send_message", {
        group_slug: slug,
        content: "hello from bob",
      });
      await callTool(agentC, "agentchat_send_message", {
        group_slug: slug,
        content: "hello from charlie",
      });

      // All three read and see all messages
      for (const [agent, name] of [
        [agentA, "alice"],
        [agentB, "bob"],
        [agentC, "charlie"],
      ] as const) {
        const data = await readWithRetry(agent, slug, { minMessages: 3 });
        expect(data.messages.length).toBeGreaterThanOrEqual(3);

        const contents = data.messages.map((m) => m.content);
        expect(contents).toContain("hello from alice");
        expect(contents).toContain("hello from bob");
        expect(contents).toContain("hello from charlie");
      }

      // Verify ordering — alice < bob < charlie by send order
      const data = await readWithRetry(agentA, slug, { minMessages: 3 });
      const aliceIdx = data.messages.findIndex(
        (m) => m.content === "hello from alice"
      );
      const bobIdx = data.messages.findIndex(
        (m) => m.content === "hello from bob"
      );
      const charlieIdx = data.messages.findIndex(
        (m) => m.content === "hello from charlie"
      );
      expect(aliceIdx).toBeLessThan(bobIdx);
      expect(bobIdx).toBeLessThan(charlieIdx);
    }, 60_000);
  });

  // ── Test 3: Edge cases ───────────────────────────────────────

  describe("Edge cases", () => {
    const slug = `edge-${RAND}`;
    let agent: Agent;

    afterAll(async () => {
      basinsToCleanup.push(slug);
      await agent?.cleanup();
    });

    it("read before any messages returns empty or error gracefully", async () => {
      agent = await createAgent("alice", "alice-claw", S2_ACCESS_TOKEN!);
      await callTool(agent, "agentchat_create_group", {
        name: "Edge Test",
        slug,
      });

      const result = await callTool(agent, "agentchat_read_messages", {
        group_slug: slug,
      });

      if (isError(result)) {
        // Reading from an empty stream may fail — that's acceptable
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text).toBeTruthy();
      } else {
        const data = parseResult(result) as {
          messages: unknown[];
          next_seq_num: number;
        };
        expect(data.messages).toEqual([]);
      }
    }, 30_000);

    it("send to group not joined returns error", async () => {
      const outsider = await createAgent("outsider", "outsider-claw", S2_ACCESS_TOKEN!);
      try {
        const result = await callTool(outsider, "agentchat_send_message", {
          group_slug: "nonexistent-group-xyz",
          content: "should fail",
        });
        expect((result as { isError?: boolean }).isError).toBe(true);
      } finally {
        await outsider.cleanup();
      }
    }, 15_000);

    it("concurrent sends from two agents both appear", async () => {
      // Reuse the edge-test group from the first test in this describe
      const agentB = await createAgent("bob", "bob-claw", S2_ACCESS_TOKEN!);

      // Generate invite and join
      const invResult = await callTool(agent, "agentchat_invite", {
        group_slug: slug,
        invitee_user: "bob",
      });
      const invData = parseResult(invResult) as { invite_token: string };
      await callTool(agentB, "agentchat_join", {
        invite_token: invData.invite_token,
      });

      // Send concurrently
      await Promise.all([
        callTool(agent, "agentchat_send_message", {
          group_slug: slug,
          content: "concurrent-alice",
        }),
        callTool(agentB, "agentchat_send_message", {
          group_slug: slug,
          content: "concurrent-bob",
        }),
      ]);

      // Both messages should appear
      const data = await readWithRetry(agent, slug, { minMessages: 2 });
      const contents = data.messages.map((m) => m.content);
      expect(contents).toContain("concurrent-alice");
      expect(contents).toContain("concurrent-bob");

      await agentB.cleanup();
    }, 30_000);
  });

  // ── Test 4: Message routing ──────────────────────────────────

  describe("Message routing", () => {
    const slug = `route-${RAND}`;
    let agent: Agent;

    afterAll(async () => {
      basinsToCleanup.push(slug);
      await agent?.cleanup();
    });

    it("bug_report routes to bug-reports stream, not general", async () => {
      agent = await createAgent("alice", "alice-claw", S2_ACCESS_TOKEN!);
      await callTool(agent, "agentchat_create_group", {
        name: "Routing Test",
        slug,
      });

      // Send a bug report
      await callTool(agent, "agentchat_send_message", {
        group_slug: slug,
        content: "null pointer in auth",
        type: "bug_report",
        metadata: { repo: "test/repo", severity: "error" },
      });

      // Should appear in bug-reports stream
      const bugData = await readWithRetry(agent, slug, {
        stream: "bug-reports",
      });
      expect(bugData.messages.length).toBeGreaterThanOrEqual(1);
      const bugMsg = bugData.messages.find(
        (m) => m.content === "null pointer in auth"
      );
      expect(bugMsg).toBeDefined();
      expect(bugMsg!.type).toBe("bug_report");
      expect((bugMsg!.metadata as Record<string, unknown>)?.severity).toBe(
        "error"
      );

      // Should NOT appear in general stream
      const genResult = await callTool(agent, "agentchat_read_messages", {
        group_slug: slug,
        stream: "general",
      });
      if (!isError(genResult)) {
        const genData = parseResult(genResult) as {
          messages: Array<Record<string, unknown>>;
        };
        if (genData.messages) {
          const leaked = genData.messages.find(
            (m) => m.content === "null pointer in auth"
          );
          expect(leaked).toBeUndefined();
        }
      }
      // If general stream read errors (empty/nonexistent), the message definitely didn't leak
    }, 30_000);

    it("prompt_report routes to prompt-reports stream", async () => {
      await callTool(agent, "agentchat_send_message", {
        group_slug: slug,
        content: "chain-of-thought works better",
        type: "prompt_report",
        metadata: { tool: "code-review" },
      });

      const data = await readWithRetry(agent, slug, {
        stream: "prompt-reports",
      });
      expect(data.messages.length).toBeGreaterThanOrEqual(1);
      const msg = data.messages.find(
        (m) => m.content === "chain-of-thought works better"
      );
      expect(msg).toBeDefined();
      expect(msg!.type).toBe("prompt_report");
    }, 30_000);

    it("regular message and dx_feedback both route to general", async () => {
      await callTool(agent, "agentchat_send_message", {
        group_slug: slug,
        content: "hello world",
      });
      await callTool(agent, "agentchat_send_message", {
        group_slug: slug,
        content: "SDK docs need work",
        type: "dx_feedback",
      });

      const data = await readWithRetry(agent, slug, {
        stream: "general",
        minMessages: 2,
      });
      const contents = data.messages.map((m) => m.content);
      expect(contents).toContain("hello world");
      expect(contents).toContain("SDK docs need work");
    }, 30_000);
  });
});
