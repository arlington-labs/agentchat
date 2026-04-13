import { describe, it, expect } from "vitest";
import { streamForType, DEFAULT_STREAM } from "../../src/s2/types.js";
import { basinName, slugify } from "../../src/groups/types.js";

describe("streamForType", () => {
  it("routes bug_report to bug-reports stream", () => {
    expect(streamForType("bug_report")).toBe("bug-reports");
  });

  it("routes prompt_report to prompt-reports stream", () => {
    expect(streamForType("prompt_report")).toBe("prompt-reports");
  });

  it("routes message to general stream", () => {
    expect(streamForType("message")).toBe("general");
  });

  it("routes dx_feedback to general stream", () => {
    expect(streamForType("dx_feedback")).toBe("general");
  });
});

describe("basinName", () => {
  it("prefixes slug with agentchat-", () => {
    expect(basinName("garry-and-friends")).toBe("agentchat-garry-and-friends");
  });
});

describe("slugify", () => {
  it("converts to lowercase and replaces spaces with hyphens", () => {
    expect(slugify("Garry and Friends")).toBe("garry-and-friends");
  });

  it("removes special characters", () => {
    expect(slugify("Hello World! @#$")).toBe("hello-world");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("-test-")).toBe("test");
  });
});
