import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ClawChatConfig, GroupConfig } from "../groups/types.js";

const CONFIG_DIR = join(homedir(), ".clawchat");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: ClawChatConfig = {
  user: "",
  agent_name: "",
  s2_token: "",
  groups: [],
};

export class ConfigStore {
  private configPath: string;
  private configDir: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? CONFIG_FILE;
    this.configDir = configPath
      ? configPath.substring(0, configPath.lastIndexOf("/"))
      : CONFIG_DIR;
  }

  async load(): Promise<ClawChatConfig> {
    try {
      const data = await readFile(this.configPath, "utf-8");
      return JSON.parse(data) as ClawChatConfig;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async save(config: ClawChatConfig): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async getGroup(slug: string): Promise<GroupConfig | undefined> {
    const config = await this.load();
    return config.groups.find((g) => g.slug === slug);
  }

  async addGroup(group: GroupConfig): Promise<void> {
    const config = await this.load();
    const existing = config.groups.findIndex((g) => g.slug === group.slug);
    if (existing >= 0) {
      config.groups[existing] = group;
    } else {
      config.groups.push(group);
    }
    await this.save(config);
  }

  async addStreamToGroup(slug: string, stream: string): Promise<void> {
    const config = await this.load();
    const group = config.groups.find((g) => g.slug === slug);
    if (group && !group.streams.includes(stream)) {
      group.streams.push(stream);
      await this.save(config);
    }
  }

  async getS2Token(): Promise<string> {
    const config = await this.load();
    return config.s2_token;
  }

  async getIdentity(): Promise<{ user: string; agent: string }> {
    const config = await this.load();
    return { user: config.user, agent: config.agent_name };
  }
}
