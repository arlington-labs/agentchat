import { S2, AppendInput, AppendRecord } from "@s2-dev/streamstore";
import type { BasinInfo, StreamInfo, ReadRecord } from "@s2-dev/streamstore";
import {
  type ClawChatMessage,
  type MessageType,
  type ReadMessagesResult,
  streamForType,
} from "./types.js";
import { basinName } from "../groups/types.js";

export class S2Client {
  private s2: S2;

  constructor(token: string) {
    this.s2 = new S2({ accessToken: token });
  }

  async createBasin(slug: string): Promise<BasinInfo> {
    const name = basinName(slug);
    const response = await this.s2.basins.create({
      basin: name,
      config: {
        createStreamOnAppend: true,
      },
    });
    return { name: response.name, scope: response.scope, state: response.state };
  }

  async deleteBasin(slug: string): Promise<void> {
    await this.s2.basins.delete({ basin: basinName(slug) });
  }

  async listBasins(prefix?: string): Promise<BasinInfo[]> {
    const result = await this.s2.basins.list({
      prefix: prefix ?? "clawchat-",
    });
    return result.basins;
  }

  async createStream(slug: string, stream: string): Promise<void> {
    const basin = this.s2.basin(basinName(slug));
    await basin.streams.create({ stream });
  }

  async listStreams(slug: string): Promise<StreamInfo[]> {
    const basin = this.s2.basin(basinName(slug));
    const result = await basin.streams.list();
    return result.streams;
  }

  async appendMessage(
    slug: string,
    message: ClawChatMessage
  ): Promise<{ seq_num: number; timestamp: string }> {
    const streamName = streamForType(message.type);
    const basin = this.s2.basin(basinName(slug));
    const stream = basin.stream(streamName);

    try {
      const record = AppendRecord.string({
        body: JSON.stringify(message),
        headers: [
          ["type", message.type],
          ["from-user", message.from.user],
          ["from-agent", message.from.agent],
        ],
      });

      const ack = await stream.append(AppendInput.create([record]));
      return {
        seq_num: ack.start.seqNum,
        timestamp: ack.start.timestamp.toISOString(),
      };
    } finally {
      await stream.close();
    }
  }

  async readMessages(
    slug: string,
    streamName: string,
    startSeqNum?: number,
    limit?: number
  ): Promise<ReadMessagesResult> {
    const basin = this.s2.basin(basinName(slug));
    const stream = basin.stream(streamName);
    const effectiveLimit = limit ?? 50;

    try {
      const input = startSeqNum !== undefined
        ? {
            start: { from: { seqNum: startSeqNum } },
            stop: { limits: { count: effectiveLimit } },
          }
        : {
            start: { from: { tailOffset: effectiveLimit }, clamp: true },
            stop: { limits: { count: effectiveLimit } },
          };

      const batch = await stream.read(input);
      const messages: ClawChatMessage[] = [];

      for (const record of batch.records) {
        try {
          const parsed = JSON.parse(record.body) as Record<string, unknown>;
          // Forward compat: ignore unknown fields, accept what we understand
          if (parsed.schema_version && parsed.type && parsed.content) {
            messages.push(parsed as unknown as ClawChatMessage);
          }
        } catch {
          // Skip malformed records
        }
      }

      const nextSeq =
        batch.records.length > 0
          ? batch.records[batch.records.length - 1].seqNum + 1
          : startSeqNum ?? 0;

      return { messages, next_seq_num: nextSeq };
    } finally {
      await stream.close();
    }
  }
}
