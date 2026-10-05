import { describe, expect, it } from "vitest";
import { adImage, adImageWide, adUnitEligible, detectAdSlot, pickAdUnit, type PublicAdUnit } from "./adunits";

const base: PublicAdUnit = {
  id: "a", kind: "banner", title: "", body: "", cta: "", images: { default: "/ads-media/a.jpg" }, videoUrl: "", posterUrl: "", html: "",
  targetUrl: "https://example.com", openMode: "external", frameable: false, placements: ["site_top", "app_top"], pages: [],
  startsAt: null, endsAt: null, priority: 0, weight: 1, freqCap: 1, autoCloseS: 10,
};

describe("ad units", () => {
  it("respects placements, pages and schedule", () => {
    expect(adUnitEligible(base, "site_top", "home")).toBe(true);
    expect(adUnitEligible(base, "site_sticky", "home")).toBe(false);
    expect(adUnitEligible({ ...base, pages: ["match"] }, "site_top", "home")).toBe(false);
    expect(adUnitEligible({ ...base, startsAt: Date.now() + 60_000 }, "site_top", "home")).toBe(false);
    expect(adUnitEligible({ ...base, endsAt: Date.now() - 1 }, "site_top", "home")).toBe(false);
  });
  it("runs html embeds on the website only", () => {
    const html = { ...base, kind: "html" as const, html: "<div></div>", images: {} };
    expect(adUnitEligible(html, "site_top", "home")).toBe(true);
    expect(adUnitEligible(html, "app_top", "home")).toBe(false);
  });
  it("prefers priority, then rotates by weight", () => {
    const a = { ...base, id: "a", weight: 1 }, b = { ...base, id: "b", weight: 3 }, c = { ...base, id: "c", priority: 5 };
    expect(pickAdUnit([a, b, c], "site_top", "home", 0.99)?.id).toBe("c");
    expect(pickAdUnit([a, b], "site_top", "home", 0.1)?.id).toBe("a");
    expect(pickAdUnit([a, b], "site_top", "home", 0.5)?.id).toBe("b");
    expect(pickAdUnit([a, b], "site_top", "home", 0.5, Date.now(), new Set(["b"]))?.id).toBe("a");
  });
});

import { creativeStem, detectAdPosition } from "./adunits";
describe("bulk upload detection", () => {
  it("maps known and ratio sizes to positions", () => {
    expect(detectAdPosition(728, 90)).toBe("top");
    expect(detectAdPosition(320, 100)).toBe("top");
    expect(detectAdPosition(970, 250)).toBe("top");
    expect(detectAdPosition(300, 250)).toBe("infeed");
    expect(detectAdPosition(1200, 628)).toBe("infeed");
    expect(detectAdPosition(800, 800)).toBe("infeed");
    expect(detectAdPosition(320, 50)).toBe("sticky");
    expect(detectAdPosition(1456, 120)).toBe("sticky");
    expect(detectAdPosition(1080, 1920)).toBe("interstitial");
    expect(detectAdPosition(320, 480)).toBe("interstitial");
    expect(detectAdPosition(640, 200)).toBe("top");
  });
  it("groups filenames by campaign stem", () => {
    expect(creativeStem("Diwali-Sale_728x90.png")).toBe("diwali sale");
    expect(creativeStem("diwali sale 300x250 infeed.jpg")).toBe("diwali sale");
    expect(creativeStem("DIWALI_SALE_mobile_320x50.webp")).toBe("diwali sale");
  });
  it("serves a separate wide creative on big screens", () => {
    const both = { ...base, images: { top: "/m.jpg", top_wide: "/w.jpg", default: "/m.jpg" } };
    expect(adImage(both, "top")).toBe("/m.jpg");
    expect(adImageWide(both, "top")).toBe("/w.jpg");
    const wideOnly = { ...base, images: { top_wide: "/w.jpg" } };
    expect(adImage(wideOnly, "top")).toBe("/w.jpg");
    expect(adImageWide(wideOnly, "top")).toBe("");
    expect(adUnitEligible(wideOnly, "site_top", "home")).toBe(true);
    expect(adImageWide(both, "infeed")).toBe("");
  });
  it("routes desktop leaderboards to the wide slot", () => {
    expect(detectAdSlot(728, 90)).toBe("top_wide");
    expect(detectAdSlot(1456, 180)).toBe("top_wide");
    expect(detectAdSlot(970, 250)).toBe("top");
    expect(detectAdSlot(320, 100)).toBe("top");
    expect(detectAdSlot(640, 200)).toBe("top");
    expect(detectAdSlot(320, 50)).toBe("sticky");
    expect(detectAdSlot(970, 66)).toBe("sticky_wide");
    expect(detectAdSlot(1200, 628)).toBe("infeed");
  });
});
