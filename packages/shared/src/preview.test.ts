import { describe, expect, it } from "vitest";
import { buildMatchPreview } from "./preview";

const team = (k: string, n: string) => ({ key: k, name: n, nameHi: n, code: k.toUpperCase(), color: "", color2: "", flag: "" });
const m = (key: string, a: string, b: string, winner: any, at: number, first = 150, venue = "Ground", status = "completed"): any => ({
  key, status, winner, startAt: at, venue, demo: false, teams: { a: team(a, a), b: team(b, b) }, points: [],
  innings: [{ team: "a", runs: first, wickets: 5, legalBalls: 120 }], result: `${winner} won`,
});

describe("match preview", () => {
  it("builds form, h2h and venue only from finished matches", () => {
    const up = m("x", "ind", "pak", undefined, 100, 0, "Ground", "upcoming");
    const uni = [up, m("1", "ind", "sl", "a", 90, 180), m("2", "pak", "ind", "a", 80, 160), m("3", "ban", "ind", "b", 70, 140, "Other")];
    const p = buildMatchPreview(up, uni);
    expect(p.form.a.map((f) => f.r)).toEqual(["W", "L", "W"]);
    expect(p.form.b.map((f) => f.r)).toEqual(["W"]);
    expect(p.h2h).toMatchObject({ played: 1, aWins: 0, bWins: 1 });
    expect(p.venue).toMatchObject({ matches: 2, avgFirst: 170, highestFirst: 180, defendsWon: 2, chasesWon: 0 });
  });
  it("hides blocks without data", () => {
    const up = m("x", "a1", "b1", undefined, 100, 0, "G", "upcoming");
    const p = buildMatchPreview(up, [up]);
    expect(p.form.a).toEqual([]); expect(p.h2h).toBeNull(); expect(p.venue).toBeNull(); expect(p.standings).toEqual([]);
  });
});
