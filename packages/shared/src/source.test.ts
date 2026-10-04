import { describe, expect, it } from "vitest";
import { sourceDisplay, sourceName } from "./source";

describe("source labels", () => {
  it("maps chatgpt payloads case-insensitively and keeps the raw payload", () => {
    expect(sourceDisplay("chatgpt_liveline_01")).toBe("ChatGPT (chatgpt_liveline_01)");
    expect(sourceDisplay("ChatGPT")).toBe("ChatGPT");
    expect(sourceName("CHATGPT_x")).toBe("ChatGPT");
  });
  it("maps known and unknown payloads", () => {
    expect(sourceDisplay("live_channel")).toBe("LiveLine channel (live_channel)");
    expect(sourceDisplay(null)).toBe("Direct");
    expect(sourceDisplay("")).toBe("Direct");
    expect(sourceDisplay("match_abc")).toBe("match_abc");
  });
});

import { sourceKey } from "./source";
describe("source keys", () => {
  it("slugs labels", () => {
    expect(sourceKey("chatgpt_liveline_01")).toBe("chatgpt");
    expect(sourceKey("live_channel")).toBe("liveline-channel");
    expect(sourceKey(undefined)).toBe("direct");
    expect(sourceKey("match_ABC")).toBe("match-abc");
  });
});
