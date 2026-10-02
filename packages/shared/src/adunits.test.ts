import { describe, expect, it } from "vitest";
import { adUnitEligible, pickAdUnit, type PublicAdUnit } from "./adunits";

const base: PublicAdUnit = {
  id: "a", kind: "banner", title: "", body: "", cta: "", images: { default: "/ads-media/a.jpg" }, videoUrl: "", posterUrl: "", html: "",
  targetUrl: "https://example.com", openMode: "external", frameable: false, placements: ["site_top", "app_top"], pages: [],
  startsAt: null, endsAt: null, priority: 0, weight: 1, freqCap: 1,
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
