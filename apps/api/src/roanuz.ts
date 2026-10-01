import { inflateSync } from "zlib";
import { io, type Socket } from "socket.io-client";
import type { CricketMatchState, Player, Team } from "@liveline/shared";
import { env } from "./env";

interface CacheMeta {
  maxAgeMs: number;
}

/**
 * Roanuz Cricket API v5.
 * Auth: POST /v5/core/{project_key}/auth/ { api_key } → rs-token.
 * Push: POST /match/{key}/subscribe/ { method: "web_socket" } then Socket.IO
 * at socket.sports.roanuz.com/cricket path /v5/websocket.
 * REST polling stays on as discovery and as the fallback when the socket drops.
 */
export class RoanuzClient {
  private token = "";
  private tokenUntil = 0;
  private nextAt = 0;
  private socket: Socket | null = null;

  constructor(
    private readonly project = env.roanuzProject,
    private readonly apiKey = env.roanuzKey,
    private readonly base = env.roanuzBase,
  ) {}

  configured(): boolean {
    return Boolean(this.project && this.apiKey);
  }

  async get(path: string): Promise<{ body: any; cache: CacheMeta }> {
    const token = await this.auth();
    await this.pace();
    const res = await fetch(`${this.base}/cricket/${this.project}${path}`, {
      headers: { "rs-token": token, accept: "application/json" },
    });
    const body = (await res.json()) as { cache?: { max_age?: number; expires?: number } };
    if (!res.ok) throw new Error(`Roanuz ${path} HTTP ${res.status}`);
    const maxAge = Number(body?.cache?.max_age ?? body?.cache?.expires ?? 15);
    return { body, cache: { maxAgeMs: Math.max(3, maxAge) * 1000 } };
  }

  async subscribeSocket(matchKey: string): Promise<void> {
    const token = await this.auth();
    await this.pace();
    await fetch(`${this.base}/cricket/${this.project}/match/${matchKey}/subscribe/`, {
      method: "POST",
      headers: { "rs-token": token, "content-type": "application/json" },
      body: JSON.stringify({ method: "web_socket" }),
    });
  }

  connectSocket(matchKeys: string[], onUpdate: (matchKey: string, payload: unknown) => void): void {
    if (!this.socket) {
      this.socket = io(env.roanuzWs, {
        path: "/v5/websocket",
        transports: ["websocket"],
        reconnection: true,
      });
      this.socket.on("on_match_update", (res: unknown) => {
        const payload = decodePush(res);
        const key = String((payload as any)?.data?.key || (payload as any)?.key || "");
        if (key) onUpdate(key, payload);
      });
    }
    for (const matchKey of matchKeys) {
      this.socket.emit("connect_to_match", { token: this.token, match_key: matchKey });
    }
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    const res = await fetch(`${this.base}/core/${this.project}/auth/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey }),
    });
    const json = (await res.json()) as any;
    const token = json?.data?.token || json?.token;
    if (!token) throw new Error("Roanuz auth did not return a token");
    this.token = token;
    const expires = Number(json?.data?.expires || 0);
    this.tokenUntil = expires > Date.now() / 1000 ? expires * 1000 - 30_000 : Date.now() + 20 * 60_000;
    return token;
  }

  private async pace() {
    const gap = Math.ceil(1000 / Math.max(1, env.roanuzRps));
    const wait = this.nextAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.nextAt = Date.now() + gap;
  }
}

function decodePush(res: unknown): unknown {
  if (typeof res !== "string") return res;
  try {
    return JSON.parse(res);
  } catch {
    try {
      return JSON.parse(inflateSync(Buffer.from(res, "base64")).toString("utf8"));
    } catch {
      return {};
    }
  }
}

function teamFrom(raw: any, side: "a" | "b"): Team {
  const code = String(raw?.code || side).slice(0, 4).toUpperCase();
  return {
    key: String(raw?.key || code.toLowerCase()),
    name: String(raw?.name || code),
    nameHi: String(raw?.alternate_name || raw?.name || code),
    code,
    color: side === "a" ? "#ff7a18" : "#7ee0ff",
    color2: "#111111",
    flag: "🏏",
  };
}

function statusOf(raw: any): CricketMatchState["status"] {
  const play = String(raw?.play_status || raw?.status || "").toLowerCase();
  if (play.includes("complete") || play === "result" || play === "finished") return "completed";
  if (play.includes("start") || play.includes("live") || play === "in_play" || play === "innings_break") return "live";
  if (String(raw?.status || "").toLowerCase() === "started") return "live";
  if (String(raw?.status || "").toLowerCase() === "completed") return "completed";
  return "upcoming";
}

/** Best-effort map of a Roanuz match document into our sport-agnostic cricket state. */
export function mapRoanuzMatch(raw: any, demo = false): CricketMatchState | null {
  const data = raw?.data || raw;
  if (!data?.key && !data?.name) return null;
  const teams = {
    a: teamFrom(data?.teams?.a || data?.teams?.[0], "a"),
    b: teamFrom(data?.teams?.b || data?.teams?.[1], "b"),
  };
  const squads = {
    a: mapSquad(data?.squad?.a, teams.a.key),
    b: mapSquad(data?.squad?.b, teams.b.key),
  };
  const play = data?.play || {};
  const innings = mapInnings(play, teams);
  const status = statusOf(data);
  const liveInn = String(play?.live?.innings || "");
  const current = Math.max(0, innings.findIndex((_, i) => liveInn.endsWith(String(i + 1))) );
  return {
    key: String(data.key),
    sport: "cricket",
    demo,
    seriesKey: String(data?.tournament?.key || "series"),
    seriesName: String(data?.tournament?.name || "Cricket"),
    name: String(data?.name || `${teams.a.name} vs ${teams.b.name}`),
    format: String(data?.format || "T20").toUpperCase().includes("ODI") ? "ODI" : "T20",
    status,
    startAt: Number(data?.start_at || data?.start_date || Date.now() / 1000) * (Number(data?.start_at) > 10_000_000_000 ? 1 : 1000),
    venue: String(data?.venue?.name || ""),
    city: String(data?.venue?.city || ""),
    pitch: String(data?.toss?.elected ? `Toss: ${data.toss.winner || ""} elected to ${data.toss.elected}` : ""),
    toss: data?.toss ? `${data.toss.winner || ""} elected to ${data.toss.elected || "bat"}` : "",
    result: play?.result?.msg || play?.result?.text,
    teams,
    squads,
    innings,
    current: innings.length ? Math.min(current < 0 ? innings.length - 1 : current, innings.length - 1) : 0,
    bowlerOrder: [],
    bowlerCursor: 0,
    nextBallAt: Date.now() + 8000,
    maxOvers: String(data?.format || "").toUpperCase().includes("ODI") ? 50 : 20,
    h2h: { played: 0, aWins: 0, bWins: 0, last: "" },
    points: [],
    strikerId: play?.live?.striker?.key,
    nonStrikerId: play?.live?.non_striker?.key,
    bowlerId: play?.live?.bowler?.key,
    target: play?.live?.required_score?.target || play?.live?.score?.target,
  };
}

function mapSquad(raw: any, teamKey: string): Player[] {
  const players = raw?.players || raw || {};
  if (Array.isArray(players)) {
    return players.map((p: any, i: number) => ({
      id: String(p.key || p.player_key || `${teamKey}_${i}`),
      name: String(p.name || "Player"),
      role: "bat" as const,
      style: String(p.role || ""),
      teamKey,
    }));
  }
  return Object.entries(players).map(([key, value]) => {
    const p = value as any;
    const role = String(p?.seasonal_role || p?.role || "bat").toLowerCase();
    return {
      id: key,
      name: String(p?.name || key),
      role: role.includes("bowl") ? "bowl" : role.includes("all") ? "all" : role.includes("keep") || role.includes("wk") ? "wk" : "bat",
      style: String(p?.batting_style || p?.bowling_style || ""),
      teamKey,
    } as Player;
  });
}

function mapInnings(play: any, teams: { a: Team; b: Team }): CricketMatchState["innings"] {
  const source = play?.innings || {};
  const order: string[] = play?.innings_order || Object.keys(source);
  return order.map((key) => {
    const inn = source[key] || {};
    const side = String(key).startsWith("b") ? "b" : "a";
    const score = inn.score || inn.score_str || {};
    return {
      team: side as "a" | "b",
      runs: Number(score.runs || 0),
      wickets: Number(score.wickets || 0),
      legalBalls: Number(score.balls || 0),
      extras: Number(inn.extra_runs?.extra || inn.extras || 0),
      batters: [],
      bowlers: [],
      overs: [],
      balls: [],
      titleHint: teams[side as "a" | "b"].name,
    };
  }) as CricketMatchState["innings"];
}

export function mapPoints(raw: any): CricketMatchState["points"] {
  const table = raw?.data?.table || raw?.data?.points || raw?.data || [];
  const rows = Array.isArray(table) ? table : Object.values(table);
  return rows.slice(0, 10).map((row: any) => ({
    team: String(row.team?.name || row.team_name || row.name || "Team"),
    p: Number(row.played || row.p || 0),
    w: Number(row.won || row.w || 0),
    l: Number(row.lost || row.l || 0),
    nrr: String(row.net_run_rate || row.nrr || "0"),
    pts: Number(row.points || row.pts || 0),
  }));
}
