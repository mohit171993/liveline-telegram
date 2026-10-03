import type { CricketMatchState } from "./cricket";

/**
 * Pre-match facts built ONLY from real, finished matches the feed has seen (no invented stats).
 * Each block is null/empty when there is no data, so the UI simply hides it.
 */
export type FormResult = { r: "W" | "L" | "T"; vs: string; key: string; at: number };
export interface MatchPreview {
  form: { a: FormResult[]; b: FormResult[] };
  h2h: { played: number; aWins: number; bWins: number; ties: number; last: { key: string; at: number; winner: string; result: string }[] } | null;
  venue: { matches: number; avgFirst: number; highestFirst: number; chasesWon: number; defendsWon: number } | null;
  standings: { team: string; side: "a" | "b" | null; p: number; w: number; l: number; nrr: string; pts: number; pos: number }[];
}

const same = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();

function sideOfTeam(m: CricketMatchState, teamKey: string, teamName: string): "a" | "b" | null {
  if (m.teams.a.key === teamKey || same(m.teams.a.name, teamName)) return "a";
  if (m.teams.b.key === teamKey || same(m.teams.b.name, teamName)) return "b";
  return null;
}

export function buildMatchPreview(match: CricketMatchState, universe: CricketMatchState[]): MatchPreview {
  const done = universe
    .filter((m) => m.key !== match.key && m.status === "completed" && m.winner && !m.demo)
    .sort((x, y) => y.startAt - x.startAt);

  const formOf = (side: "a" | "b"): FormResult[] => {
    const t = match.teams[side];
    const out: FormResult[] = [];
    for (const m of done) {
      const s = sideOfTeam(m, t.key, t.name);
      if (!s) continue;
      const opp = m.teams[s === "a" ? "b" : "a"];
      out.push({ r: m.winner === "tie" ? "T" : m.winner === s ? "W" : "L", vs: opp.code, key: m.key, at: m.startAt });
      if (out.length >= 5) break;
    }
    return out;
  };

  const meetings = done.filter((m) => sideOfTeam(m, match.teams.a.key, match.teams.a.name) && sideOfTeam(m, match.teams.b.key, match.teams.b.name));
  let aWins = 0, bWins = 0, ties = 0;
  for (const m of meetings) {
    if (m.winner === "tie") { ties++; continue; }
    const winnerTeam = m.teams[m.winner as "a" | "b"];
    if (sideOfTeam(match, winnerTeam.key, winnerTeam.name) === "a") aWins++; else bWins++;
  }
  const h2h = meetings.length ? {
    played: meetings.length, aWins, bWins, ties,
    last: meetings.slice(0, 3).map((m) => ({ key: m.key, at: m.startAt, winner: m.winner === "tie" ? "Tie" : m.teams[m.winner as "a" | "b"].name, result: m.result || "" })),
  } : null;

  // Venue: finished matches at the same ground with a first innings on record (needs ≥ 2 to be meaningful).
  const atVenue = match.venue ? done.filter((m) => same(m.venue, match.venue) && m.innings.length >= 1 && m.innings[0].legalBalls > 0) : [];
  let venue: MatchPreview["venue"] = null;
  if (atVenue.length >= 2) {
    const firsts = atVenue.map((m) => m.innings[0].runs);
    let chasesWon = 0, defendsWon = 0;
    for (const m of atVenue) {
      if (m.winner === "tie") continue;
      if (m.winner === m.innings[0].team) defendsWon++; else chasesWon++;
    }
    venue = { matches: atVenue.length, avgFirst: Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length), highestFirst: Math.max(...firsts), chasesWon, defendsWon };
  }

  // Standings: the provider's points table rows for this series (real), with both teams marked.
  const rows = (match.points || []).filter((r) => r.p > 0);
  const standings = rows.map((r, i) => ({
    ...r, pos: i + 1,
    side: same(r.team, match.teams.a.name) ? ("a" as const) : same(r.team, match.teams.b.name) ? ("b" as const) : null,
  }));

  return { form: { a: formOf("a"), b: formOf("b") }, h2h, venue, standings: standings.some((s) => s.side) ? standings : [] };
}
