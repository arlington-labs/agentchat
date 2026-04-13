import { S2Client } from "../s2/client.js";
import { ConfigStore } from "../config/store.js";
import {
  type GroupConfig,
  type InvitePayload,
  basinName,
  slugify,
  validateSlug,
} from "./types.js";
import { DEFAULT_STREAM } from "../s2/types.js";

export class GroupManager {
  constructor(
    private s2: S2Client,
    private config: ConfigStore
  ) {}

  async createGroup(
    name: string,
    slug?: string
  ): Promise<{ slug: string; basin: string; streams: string[] }> {
    const groupSlug = slug ?? slugify(name);
    validateSlug(groupSlug);
    const basin = basinName(groupSlug);

    await this.s2.createBasin(groupSlug);

    // Create the default general stream
    await this.s2.createStream(groupSlug, DEFAULT_STREAM);

    const streams = [DEFAULT_STREAM];

    await this.config.addGroup({
      slug: groupSlug,
      name,
      streams,
      role: "owner",
    });

    return { slug: groupSlug, basin, streams };
  }

  async listGroups(): Promise<GroupConfig[]> {
    const config = await this.config.load();
    return config.groups;
  }

  async generateInvite(groupSlug: string): Promise<string> {
    const group = await this.config.getGroup(groupSlug);
    if (!group) {
      throw new Error(`Group not found: ${groupSlug}`);
    }

    if (group.role !== "owner") {
      throw new Error("Only group owners can generate invites");
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const payload: InvitePayload = {
      slug: group.slug,
      name: group.name,
      streams: group.streams,
      expires_at: expiresAt,
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64url");
  }

  async joinGroup(inviteToken: string): Promise<{
    group_slug: string;
    basin: string;
    streams: string[];
  }> {
    let payload: InvitePayload;
    try {
      const decoded = Buffer.from(inviteToken, "base64url").toString("utf-8");
      payload = JSON.parse(decoded) as InvitePayload;
    } catch {
      throw new Error("Invalid invite token");
    }

    if (!payload.slug || !payload.streams || !payload.expires_at) {
      throw new Error("Malformed invite token");
    }

    if (new Date(payload.expires_at) < new Date()) {
      throw new Error("Invite token has expired");
    }

    validateSlug(payload.slug);

    await this.config.addGroup({
      slug: payload.slug,
      name: payload.name,
      streams: payload.streams,
      role: "member",
    });

    return {
      group_slug: payload.slug,
      basin: basinName(payload.slug),
      streams: payload.streams,
    };
  }
}
