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
    expect(sourceDisplay("promo_xyz")).toBe("promo_xyz");
  });
});

import { sourceKey } from "./source";
describe("source keys", () => {
  it("slugs labels", () => {
    expect(sourceKey("chatgpt_liveline_01")).toBe("chatgpt");
    expect(sourceKey("live_channel")).toBe("liveline-channel");
    expect(sourceKey(undefined)).toBe("direct");
    expect(sourceKey("match_ABC")).toBe("promo-xyz");
  });
});

import { describe as d2, it as i2, expect as e2 } from "vitest";
import { sourceDisplay as sd2, sourceKey as sk2 } from "./source";
d2("source rules: ads + match links", () => {
  i2("labels ad and match payloads", () => {
    e2(sd2("ad_ipl_01")).toBe("Telegram Ads (ad_ipl_01)");
    e2(sk2("tgads-cricket")).toBe("telegram-ads");
    e2(sd2("match_a-rz--cricket--x1")).toBe("Match link (match_a-rz--cricket--x1)");
    e2(sk2("match_a-rz--cricket--x1")).toBe("match-link");
  });
});
