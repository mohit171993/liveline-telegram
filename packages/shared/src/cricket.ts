import { currentRunRate, oversLabel, projectedScore, requiredRunRate, winProbability, type WinProb } from "./winprob";
import { castLook, teamMood, type Cartoon, type RoleId } from "./avatar";

export type Sport = "cricket" | "football" | "kabaddi";
export type MatchStatus = "live" | "upcoming" | "completed";

export interface Team {
  key: string;
  name: string;
  nameHi: string;
  code: string;
  color: string;
  color2: string;
  flag: string;
}

export interface Player {
  id: string;
  name: string;
  role: "bat" | "bowl" | "all" | "wk";
  style: string;
  teamKey: string;
}

export interface Ball {
  i: number;
  innings: number;
  over: number;
  ballInOver: number;
  runs: number;
  batRuns: number;
  extra: number;
  extraType?: "wd" | "nb";
  wicket: boolean;
  dismissal?: string;
  batterId: string;
  bowlerId: string;
  text: string;
  textHi: string;
  wagonX: number;
  wagonY: number;
  ts: number;
}

export interface BatterCard {
  id: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  dismissal?: string;
}

export interface BowlerCard {
  id: string;
  balls: number;
  maidens: number;
  runs: number;
  wickets: number;
}

export interface Innings {
  team: "a" | "b";
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: number;
  batters: BatterCard[];
  bowlers: BowlerCard[];
  overs: { n: number; runs: number; wickets: number; balls: string[] }[];
  balls: Ball[];
}

export interface CricketMatchState {
  key: string;
  sport: "cricket";
  demo: boolean;
  seriesKey: string;
  seriesName: string;
  name: string;
  format: "T20" | "ODI";
  status: MatchStatus;
  startAt: number;
  venue: string;
  city: string;
  pitch: string;
  toss: string;
  result?: string;
  winner?: "a" | "b" | "tie";
  teams: { a: Team; b: Team };
  squads: { a: Player[]; b: Player[] };
  innings: Innings[];
  current: number;
  strikerId?: string;
  nonStrikerId?: string;
  bowlerId?: string;
  bowlerOrder: string[];
  bowlerCursor: number;
  nextBallAt: number;
  target?: number;
  maxOvers: number;
  h2h: { played: number; aWins: number; bWins: number; last: string };
  points: { team: string; p: number; w: number; l: number; nrr: string; pts: number }[];
  breakUntil?: number;
  breakKind?: "innings" | "timeout";
}

export interface BatterView {
  id: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strike: boolean;
  look: Cartoon;
}

export interface BowlerView {
  id: string;
  name: string;
  overs: string;
  runs: number;
  wickets: number;
  economy: number;
  look: Cartoon;
}

export interface MatchView {
  key: string;
  sport: Sport;
  demo: boolean;
  seriesKey: string;
  seriesName: string;
  name: string;
  format: string;
  status: MatchStatus;
  startAt: number;
  venue: string;
  city: string;
  pitch: string;
  toss: string;
  result?: string;
  teams: { a: Team; b: Team };
  scoreline: { a: string; b: string };
  live: null | {
    batting: "a" | "b";
    runs: number;
    wickets: number;
    overs: string;
    crr: number;
    rrr: number | null;
    target: number | null;
    projected: number | null;
    need: string | null;
    needHi: string | null;
    win: WinProb;
    striker: BatterView | null;
    nonStriker: BatterView | null;
    bowler: BowlerView | null;
    partnership: { runs: number; balls: number };
    thisOver: string[];
    recent: string[];
    mood: { emoji: string; label: string; labelHi: string };
  };
  innings?: InningsView[];
  commentary?: { over: string; text: string; textHi: string; kind: string }[];
  wagon?: { x: number; y: number; runs: number; wicket: boolean }[];
  manhattan?: { over: number; runs: number; wickets: number; innings: number }[];
  worm?: { over: number; runs: number; innings: number }[];
  xi?: { a: (Player & { look: Cartoon })[]; b: (Player & { look: Cartoon })[] };
  h2h?: CricketMatchState["h2h"];
  points?: CricketMatchState["points"];
  nextBallIndex?: number;
  nextBallAt?: number;
  predictionOpen?: { ball: boolean; over: boolean; match: boolean };
  break?: { kind: "innings" | "timeout"; until: number } | null;
  overs10?: { open: boolean; innings: number; actual: number | null };
}

export interface InningsView {
  team: "a" | "b";
  title: string;
  runs: number;
  wickets: number;
  overs: string;
  extras: number;
  batters: (BatterCard & { name: string; look: Cartoon })[];
  bowlers: (BowlerCard & { name: string; overs: string; economy: number; look: Cartoon })[];
}

const IND: Team = { key: "ind", name: "India", nameHi: "भारत", code: "IND", color: "#ff7a18", color2: "#138808", flag: "🇮🇳" };
const AUS: Team = { key: "aus", name: "Australia", nameHi: "ऑस्ट्रेलिया", code: "AUS", color: "#ffd200", color2: "#00843d", flag: "🇦🇺" };
const ENG: Team = { key: "eng", name: "England", nameHi: "इंग्लैंड", code: "ENG", color: "#1a3cff", color2: "#cf142b", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" };
const SA: Team = { key: "sa", name: "South Africa", nameHi: "दक्षिण अफ्रीका", code: "SA", color: "#007a4d", color2: "#ffb81c", flag: "🇿🇦" };
const NZ: Team = { key: "nz", name: "New Zealand", nameHi: "न्यूज़ीलैंड", code: "NZ", color: "#000000", color2: "#888888", flag: "🇳🇿" };
const PAK: Team = { key: "pak", name: "Pakistan", nameHi: "पाकिस्तान", code: "PAK", color: "#01411c", color2: "#ffffff", flag: "🇵🇰" };

function P(id: string, name: string, role: Player["role"], style: string, teamKey: string): Player {
  return { id, name, role, style, teamKey };
}

const SQUADS: Record<string, Player[]> = {
  ind: [
    P("ind_rohit", "Rohit Sharma", "bat", "Right-hand bat", "ind"),
    P("ind_gill", "Shubman Gill", "bat", "Right-hand bat", "ind"),
    P("ind_kohli", "Virat Kohli", "bat", "Right-hand bat", "ind"),
    P("ind_sky", "Suryakumar Yadav", "bat", "Right-hand bat", "ind"),
    P("ind_hardik", "Hardik Pandya", "all", "Right-hand bat · Right-arm fast", "ind"),
    P("ind_pant", "Rishabh Pant", "wk", "Left-hand bat", "ind"),
    P("ind_axar", "Axar Patel", "all", "Left-hand bat · Left-arm spin", "ind"),
    P("ind_jadeja", "Ravindra Jadeja", "all", "Left-hand bat · Left-arm spin", "ind"),
    P("ind_kuldeep", "Kuldeep Yadav", "bowl", "Left-arm wrist spin", "ind"),
    P("ind_bumrah", "Jasprit Bumrah", "bowl", "Right-arm fast", "ind"),
    P("ind_arshdeep", "Arshdeep Singh", "bowl", "Left-arm fast", "ind"),
  ],
  aus: [
    P("aus_head", "Travis Head", "bat", "Left-hand bat", "aus"),
    P("aus_marsh", "Mitchell Marsh", "all", "Right-hand bat · Right-arm medium", "aus"),
    P("aus_inglis", "Josh Inglis", "wk", "Right-hand bat", "aus"),
    P("aus_maxwell", "Glenn Maxwell", "all", "Right-hand bat · Off spin", "aus"),
    P("aus_david", "Tim David", "bat", "Right-hand bat", "aus"),
    P("aus_wade", "Matthew Wade", "wk", "Left-hand bat", "aus"),
    P("aus_stoinis", "Marcus Stoinis", "all", "Right-hand bat · Right-arm medium", "aus"),
    P("aus_cummins", "Pat Cummins", "bowl", "Right-arm fast", "aus"),
    P("aus_starc", "Mitchell Starc", "bowl", "Left-arm fast", "aus"),
    P("aus_zampa", "Adam Zampa", "bowl", "Leg spin", "aus"),
    P("aus_hazlewood", "Josh Hazlewood", "bowl", "Right-arm fast", "aus"),
  ],
  eng: [
    P("eng_butler", "Jos Buttler", "wk", "Right-hand bat", "eng"),
    P("eng_salt", "Phil Salt", "wk", "Right-hand bat", "eng"),
    P("eng_root", "Joe Root", "bat", "Right-hand bat", "eng"),
    P("eng_brook", "Harry Brook", "bat", "Right-hand bat", "eng"),
    P("eng_stokes", "Ben Stokes", "all", "Left-hand bat · Right-arm fast", "eng"),
    P("eng_livingstone", "Liam Livingstone", "all", "Right-hand bat · Off spin", "eng"),
    P("eng_moeen", "Moeen Ali", "all", "Left-hand bat · Off spin", "eng"),
    P("eng_rashid", "Adil Rashid", "bowl", "Leg spin", "eng"),
    P("eng_archer", "Jofra Archer", "bowl", "Right-arm fast", "eng"),
    P("eng_wood", "Mark Wood", "bowl", "Right-arm fast", "eng"),
    P("eng_topley", "Reece Topley", "bowl", "Left-arm fast", "eng"),
  ],
  sa: [
    P("sa_bavuma", "Temba Bavuma", "bat", "Right-hand bat", "sa"),
    P("sa_deKock", "Quinton de Kock", "wk", "Left-hand bat", "sa"),
    P("sa_markram", "Aiden Markram", "bat", "Right-hand bat", "sa"),
    P("sa_miller", "David Miller", "bat", "Left-hand bat", "sa"),
    P("sa_klaasen", "Heinrich Klaasen", "wk", "Right-hand bat", "sa"),
    P("sa_stubbs", "Tristan Stubbs", "bat", "Right-hand bat", "sa"),
    P("sa_jansen", "Marco Jansen", "all", "Right-arm fast", "sa"),
    P("sa_maharaj", "Keshav Maharaj", "bowl", "Left-arm spin", "sa"),
    P("sa_rabada", "Kagiso Rabada", "bowl", "Right-arm fast", "sa"),
    P("sa_ngidi", "Lungi Ngidi", "bowl", "Right-arm fast", "sa"),
    P("sa_nortje", "Anrich Nortje", "bowl", "Right-arm fast", "sa"),
  ],
  nz: [
    P("nz_williamson", "Kane Williamson", "bat", "Right-hand bat", "nz"),
    P("nz_conway", "Devon Conway", "wk", "Left-hand bat", "nz"),
    P("nz_phillips", "Glenn Phillips", "bat", "Right-hand bat", "nz"),
    P("nz_mitchell", "Daryl Mitchell", "bat", "Right-hand bat", "nz"),
    P("nz_santner", "Mitchell Santner", "all", "Left-arm spin", "nz"),
    P("nz_ravindra", "Rachin Ravindra", "all", "Left-hand bat · Left-arm spin", "nz"),
    P("nz_chapman", "Mark Chapman", "bat", "Left-hand bat", "nz"),
    P("nz_southee", "Tim Southee", "bowl", "Right-arm fast", "nz"),
    P("nz_boult", "Trent Boult", "bowl", "Left-arm fast", "nz"),
    P("nz_ferguson", "Lockie Ferguson", "bowl", "Right-arm fast", "nz"),
    P("nz_sodhi", "Ish Sodhi", "bowl", "Leg spin", "nz"),
  ],
  pak: [
    P("pak_babar", "Babar Azam", "bat", "Right-hand bat", "pak"),
    P("pak_rizwan", "Mohammad Rizwan", "wk", "Right-hand bat", "pak"),
    P("pak_fakhar", "Fakhar Zaman", "bat", "Left-hand bat", "pak"),
    P("pak_salman", "Agha Salman", "all", "Right-hand bat", "pak"),
    P("pak_iftikhar", "Iftikhar Ahmed", "all", "Right-hand bat · Off spin", "pak"),
    P("pak_shadab", "Shadab Khan", "all", "Leg spin", "pak"),
    P("pak_shaheen", "Shaheen Afridi", "bowl", "Left-arm fast", "pak"),
    P("pak_naseem", "Naseem Shah", "bowl", "Right-arm fast", "pak"),
    P("pak_haris", "Haris Rauf", "bowl", "Right-arm fast", "pak"),
    P("pak_abrar", "Abrar Ahmed", "bowl", "Leg spin", "pak"),
    P("pak_wasim", "Mohammad Wasim", "bowl", "Right-arm fast", "pak"),
  ],
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playerName(match: CricketMatchState, id: string): string {
  const all = [...match.squads.a, ...match.squads.b];
  return all.find((p) => p.id === id)?.name || id;
}

function emptyInnings(team: "a" | "b"): Innings {
  return { team, runs: 0, wickets: 0, legalBalls: 0, extras: 0, batters: [], bowlers: [], overs: [], balls: [] };
}

function ensureBatter(inn: Innings, id: string): BatterCard {
  let card = inn.batters.find((b) => b.id === id);
  if (!card) {
    card = { id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
    inn.batters.push(card);
  }
  return card;
}

function ensureBowler(inn: Innings, id: string): BowlerCard {
  let card = inn.bowlers.find((b) => b.id === id);
  if (!card) {
    card = { id, balls: 0, maidens: 0, runs: 0, wickets: 0 };
    inn.bowlers.push(card);
  }
  return card;
}

function nextBatter(match: CricketMatchState, inn: Innings): string | undefined {
  const squad = match.squads[inn.team];
  return squad.find((p) => p.id !== match.nonStrikerId && !inn.batters.some((b) => b.id === p.id && b.out))?.id;
}

function ballToken(ball: Ball): string {
  if (ball.wicket) return "W";
  if (ball.extraType === "wd") return "wd";
  if (ball.extraType === "nb") return "nb";
  if (ball.batRuns === 0 && ball.extra === 0) return "·";
  return String(ball.batRuns + ball.extra);
}

function commentary(ball: Ball, batter: string, bowler: string): { text: string; textHi: string } {
  if (ball.wicket) {
    return {
      text: `${bowler} strikes. ${batter} is gone — ${ball.dismissal}.`,
      textHi: `${bowler} का वार। ${batter} आउट — ${ball.dismissal}.`,
    };
  }
  if (ball.extraType === "wd") {
    return { text: `Wide from ${bowler}. Extra run.`, textHi: `${bowler} की वाइड। अतिरिक्त रन।` };
  }
  if (ball.batRuns >= 6) {
    return { text: `${batter} clears the rope. SIX.`, textHi: `${batter} ने रस्सी पार की। छक्का।` };
  }
  if (ball.batRuns === 4) {
    return { text: `${batter} finds the gap. FOUR.`, textHi: `${batter} ने गैप ढूँढा। चौका।` };
  }
  if (ball.batRuns === 0) {
    return { text: `${bowler} to ${batter}, no run. Defended.`, textHi: `${bowler} से ${batter}, कोई रन नहीं।` };
  }
  return {
    text: `${batter} works it for ${ball.batRuns}.`,
    textHi: `${batter} ने ${ball.batRuns} रन लिए।`,
  };
}

export interface AdvanceResult {
  match: CricketMatchState;
  ball?: Ball;
  moment?: "FOUR" | "SIX" | "WICKET";
  events: string[];
}

export function advanceMatch(input: CricketMatchState, rnd: () => number, now: number): AdvanceResult {
  const match: CricketMatchState = structuredClone(input);
  const events: string[] = [];
  if (match.status !== "live") return { match, events };
  if (match.breakUntil && now < match.breakUntil) return { match, events };
  if (match.breakUntil && now >= match.breakUntil) {
    match.breakUntil = undefined;
    match.breakKind = undefined;
  }
  const inn = match.innings[match.current];
  if (!inn || !match.strikerId || !match.bowlerId) return { match, events };

  const overBefore = Math.floor(inn.legalBalls / 6);
  const roll = rnd();
  let kind: "wd" | "w" | "6" | "4" | "3" | "2" | "1" | "0";
  if (roll < 0.035) kind = "wd";
  else if (roll < 0.09) kind = "w";
  else if (roll < 0.15) kind = "6";
  else if (roll < 0.28) kind = "4";
  else if (roll < 0.31) kind = "3";
  else if (roll < 0.46) kind = "2";
  else if (roll < 0.74) kind = "1";
  else kind = "0";

  const batter = ensureBatter(inn, match.strikerId);
  const bowler = ensureBowler(inn, match.bowlerId);
  const batterName = playerName(match, match.strikerId);
  const bowlerName = playerName(match, match.bowlerId);
  const ball: Ball = {
    i: inn.balls.length,
    innings: match.current,
    over: overBefore,
    ballInOver: (inn.legalBalls % 6) + 1,
    runs: 0,
    batRuns: 0,
    extra: 0,
    wicket: false,
    batterId: match.strikerId,
    bowlerId: match.bowlerId,
    text: "",
    textHi: "",
    wagonX: Math.round(8 + rnd() * 84),
    wagonY: Math.round(12 + rnd() * 70),
    ts: now,
  };

  let moment: AdvanceResult["moment"];
  if (kind === "wd") {
    ball.extra = 1;
    ball.extraType = "wd";
    ball.runs = 1;
    ball.ballInOver = 0;
    inn.runs += 1;
    inn.extras += 1;
    bowler.runs += 1;
  } else {
    inn.legalBalls += 1;
    bowler.balls += 1;
    if (kind === "w") {
      ball.wicket = true;
      ball.dismissal = rnd() > 0.5 ? `b ${bowlerName}` : `c ${playerName(match, match.nonStrikerId || bowler.id)} b ${bowlerName}`;
      batter.out = true;
      batter.dismissal = ball.dismissal;
      batter.balls += 1;
      inn.wickets += 1;
      bowler.wickets += 1;
      moment = "WICKET";
      events.push(`wicket:${match.key}:${match.current}:${inn.wickets}`);
      const replacement = nextBatter(match, inn);
      match.strikerId = replacement;
    } else {
      const runs = kind === "0" ? 0 : Number(kind);
      ball.batRuns = runs;
      ball.runs = runs;
      batter.runs += runs;
      batter.balls += 1;
      if (runs === 4) batter.fours += 1;
      if (runs === 6) batter.sixes += 1;
      inn.runs += runs;
      bowler.runs += runs;
      if (runs === 4) moment = "FOUR";
      if (runs === 6) moment = "SIX";
      if (runs % 2 === 1 && match.nonStrikerId) {
        const swap = match.strikerId;
        match.strikerId = match.nonStrikerId;
        match.nonStrikerId = swap;
      }
      if (batter.runs >= 50 && batter.runs - runs < 50) events.push(`fifty:${match.key}:${batter.id}`);
      if (batter.runs >= 100 && batter.runs - runs < 100) events.push(`hundred:${match.key}:${batter.id}`);
    }
    const overIndex = Math.floor((inn.legalBalls - 1) / 6);
    while (inn.overs.length <= overIndex) inn.overs.push({ n: inn.overs.length + 1, runs: 0, wickets: 0, balls: [] });
    const over = inn.overs[overIndex];
    over.runs += ball.runs;
    if (ball.wicket) over.wickets += 1;
    over.balls.push(ballToken(ball));
    if (inn.legalBalls % 6 === 0) {
      if (over.runs === 0) bowler.maidens += 1;
      if (match.nonStrikerId && match.strikerId) {
        const swap = match.strikerId;
        match.strikerId = match.nonStrikerId;
        match.nonStrikerId = swap;
      }
      match.bowlerCursor = (match.bowlerCursor + 1) % Math.max(1, match.bowlerOrder.length);
      match.bowlerId = match.bowlerOrder[match.bowlerCursor];
      events.push(`over:${match.key}:${match.current}:${over.n}`);
      if ((over.n === 6 || over.n === 15) && inn.wickets < 10 && inn.legalBalls < match.maxOvers * 6) {
        match.breakUntil = now + 20_000;
        match.breakKind = "timeout";
        events.push(`timeout:${match.key}:${match.current}:${over.n}`);
      }
    }
  }

  const lines = commentary(ball, batterName, bowlerName);
  ball.text = lines.text;
  ball.textHi = lines.textHi;
  inn.balls.push(ball);

  const finished =
    inn.wickets >= 10 ||
    inn.legalBalls >= match.maxOvers * 6 ||
    (match.target != null && inn.runs >= match.target);

  if (finished) {
    if (match.current === 0 && !(match.target != null)) {
      match.target = inn.runs + 1;
      match.breakUntil = now + 25_000;
      match.breakKind = "innings";
      events.push(`innings_break:${match.key}`);
      const chase = emptyInnings(match.teams.a.key === match.teams[inn.team].key ? "b" : "b");
      chase.team = inn.team === "a" ? "b" : "a";
      match.innings.push(chase);
      match.current = 1;
      const squad = match.squads[chase.team];
      match.strikerId = squad[0]?.id;
      match.nonStrikerId = squad[1]?.id;
      const bowlers = match.squads[inn.team].filter((p) => p.role === "bowl" || p.role === "all").map((p) => p.id);
      match.bowlerOrder = bowlers.length ? bowlers : [match.squads[inn.team][0].id];
      match.bowlerCursor = 0;
      match.bowlerId = match.bowlerOrder[0];
      if (match.strikerId) ensureBatter(chase, match.strikerId);
      if (match.nonStrikerId) ensureBatter(chase, match.nonStrikerId);
    } else {
      match.status = "completed";
      const chaseRuns = inn.runs;
      const target = match.target || 0;
      const battingTeam = match.teams[inn.team];
      const bowlingSide = inn.team === "a" ? "b" : "a";
      if (match.target != null && chaseRuns >= target) {
        const left = 10 - inn.wickets;
        match.winner = inn.team;
        match.result = `${battingTeam.name} won by ${left} wicket${left === 1 ? "" : "s"}`;
      } else if (match.target != null && chaseRuns === target - 1) {
        match.winner = "tie";
        match.result = "Match tied";
      } else if (match.target != null) {
        match.winner = bowlingSide;
        const margin = target - 1 - chaseRuns;
        match.result = `${match.teams[bowlingSide].name} won by ${margin} run${margin === 1 ? "" : "s"}`;
      } else {
        match.winner = inn.runs > 0 ? inn.team : "tie";
        match.result = "Match complete";
      }
      events.push(`result:${match.key}:${match.winner}`);
    }
  }

  return { match, ball, moment, events };
}

function playUntil(match: CricketMatchState, pred: (m: CricketMatchState) => boolean, rnd: () => number, now: number): void {
  let guard = 0;
  while (pred(match) && guard < 500) {
    const step = advanceMatch(match, rnd, now);
    Object.assign(match, step.match);
    match.breakUntil = undefined;
    match.breakKind = undefined;
    guard += 1;
  }
}

function baseMatch(partial: Omit<CricketMatchState, "bowlerOrder" | "bowlerCursor" | "nextBallAt" | "current" | "innings"> & {
  innings?: Innings[];
}): CricketMatchState {
  return {
    ...partial,
    innings: partial.innings || [],
    current: 0,
    bowlerOrder: [],
    bowlerCursor: 0,
    nextBallAt: partial.startAt,
  };
}

function freshLive(now: number): CricketMatchState {
  const match = baseMatch({
    key: "demo_ind_aus",
    sport: "cricket",
    demo: true,
    seriesKey: "floodlight_t20",
    seriesName: "Night Floodlight T20",
    name: "India vs Australia",
    format: "T20",
    status: "live",
    startAt: now - 1000 * 60 * 150,
    venue: "Wankhede Stadium",
    city: "Mumbai",
    pitch: "Dry, true bounce. Chasing under lights is the easier job if the new ball survives the powerplay.",
    toss: "Australia won the toss and elected to bowl",
    teams: { a: IND, b: AUS },
    squads: { a: SQUADS.ind, b: SQUADS.aus },
    maxOvers: 20,
    h2h: { played: 24, aWins: 13, bWins: 10, last: "India won the last T20 by 6 wickets" },
    points: [
      { team: "India", p: 3, w: 2, l: 1, nrr: "+0.84", pts: 4 },
      { team: "Australia", p: 3, w: 2, l: 1, nrr: "+0.41", pts: 4 },
      { team: "England", p: 3, w: 1, l: 2, nrr: "-0.22", pts: 2 },
      { team: "South Africa", p: 3, w: 1, l: 2, nrr: "-0.90", pts: 2 },
    ],
  });
  const first = emptyInnings("a");
  match.innings = [first];
  match.strikerId = SQUADS.ind[0].id;
  match.nonStrikerId = SQUADS.ind[1].id;
  match.bowlerOrder = SQUADS.aus.filter((p) => p.role === "bowl" || p.role === "all").map((p) => p.id);
  match.bowlerId = match.bowlerOrder[0];
  ensureBatter(first, match.strikerId);
  ensureBatter(first, match.nonStrikerId!);
  return match;
}

function startLiveChase(now: number): CricketMatchState {
  const chaseBalls = 16 * 6 + 2;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = mulberry32(20261000 + seed);
    const match = freshLive(now);
    playUntil(match, (m) => m.status === "live" && m.current === 0, rnd, now);
    if (match.current !== 1 || match.status !== "live") continue;
    playUntil(
      match,
      (m) => m.status === "live" && m.current === 1 && m.innings[1].legalBalls < chaseBalls,
      rnd,
      now,
    );
    const chase = match.innings[1];
    if (!chase || match.status !== "live") continue;
    if (chase.legalBalls < chaseBalls - 6) continue;
    const need = (match.target || 0) - chase.runs;
    if (need < 20 || need > 80) continue;
    match.nextBallAt = now + 8000;
    return match;
  }
  const match = freshLive(now);
  const rnd = mulberry32(7);
  playUntil(match, (m) => m.status === "live" && m.current === 0, rnd, now);
  match.nextBallAt = now + 8000;
  match.status = "live";
  return match;
}

export function buildDemoUniverse(now = Date.now()): CricketMatchState[] {
  const live = startLiveChase(now);
  const upcoming: CricketMatchState = baseMatch({
    key: "demo_eng_sa",
    sport: "cricket",
    demo: true,
    seriesKey: "floodlight_t20",
    seriesName: "Night Floodlight T20",
    name: "England vs South Africa",
    format: "T20",
    status: "upcoming",
    startAt: now + 1000 * 60 * 95,
    venue: "Eden Gardens",
    city: "Kolkata",
    pitch: "Even grass, little swing after the first hour. Toss will matter.",
    toss: "Toss coming up",
    teams: { a: ENG, b: SA },
    squads: { a: SQUADS.eng, b: SQUADS.sa },
    maxOvers: 20,
    h2h: { played: 18, aWins: 8, bWins: 9, last: "South Africa won by 4 runs" },
    points: live.points,
    innings: [],
  });
  const later: CricketMatchState = baseMatch({
    key: "demo_ind_eng",
    sport: "cricket",
    demo: true,
    seriesKey: "floodlight_t20",
    seriesName: "Night Floodlight T20",
    name: "India vs England",
    format: "T20",
    status: "upcoming",
    startAt: now + 1000 * 60 * 60 * 26,
    venue: "Narendra Modi Stadium",
    city: "Ahmedabad",
    pitch: "Big boundaries, used surface, spinners in the game.",
    toss: "Tomorrow",
    teams: { a: IND, b: ENG },
    squads: { a: SQUADS.ind, b: SQUADS.eng },
    maxOvers: 20,
    h2h: { played: 22, aWins: 12, bWins: 9, last: "India won by 7 wickets" },
    points: live.points,
    innings: [],
  });
  const recent = completedMatch(now);
  return [live, upcoming, later, recent];
}

function completedMatch(now: number): CricketMatchState {
  return baseMatch({
    key: "demo_pak_nz",
    sport: "cricket",
    demo: true,
    seriesKey: "gulf_tri",
    seriesName: "Gulf Tri-Series",
    name: "Pakistan vs New Zealand",
    format: "T20",
    status: "completed",
    startAt: now - 1000 * 60 * 60 * 8,
    venue: "Dubai International",
    city: "Dubai",
    pitch: "Two-paced, slower through the night.",
    toss: "New Zealand won the toss and bowled",
    result: "Pakistan won by 5 wickets",
    winner: "a",
    teams: { a: PAK, b: NZ },
    squads: { a: SQUADS.pak, b: SQUADS.nz },
    maxOvers: 20,
    h2h: { played: 16, aWins: 7, bWins: 9, last: "Pakistan won by 5 wickets" },
    points: [
      { team: "Pakistan", p: 2, w: 2, l: 0, nrr: "+1.10", pts: 4 },
      { team: "New Zealand", p: 2, w: 0, l: 2, nrr: "-1.10", pts: 0 },
    ],
    innings: [
      {
        team: "b",
        runs: 164,
        wickets: 8,
        legalBalls: 120,
        extras: 7,
        batters: [
          { id: "nz_conway", runs: 41, balls: 28, fours: 4, sixes: 1, out: true, dismissal: "c Rizwan b Shaheen" },
          { id: "nz_williamson", runs: 38, balls: 31, fours: 3, sixes: 0, out: true, dismissal: "b Abrar" },
          { id: "nz_mitchell", runs: 44, balls: 29, fours: 2, sixes: 2, out: true, dismissal: "c Babar b Shadab" },
        ],
        bowlers: [
          { id: "pak_shaheen", balls: 24, maidens: 0, runs: 28, wickets: 2 },
          { id: "pak_abrar", balls: 24, maidens: 0, runs: 31, wickets: 2 },
        ],
        overs: Array.from({ length: 20 }, (_, n) => ({ n: n + 1, runs: n % 5 === 0 ? 12 : 7, wickets: n === 4 || n === 11 ? 1 : 0, balls: ["1", "1", "4", "·", "1", "·"] })),
        balls: [],
      },
      {
        team: "a",
        runs: 167,
        wickets: 5,
        legalBalls: 113,
        extras: 6,
        batters: [
          { id: "pak_babar", runs: 62, balls: 41, fours: 6, sixes: 1, out: true, dismissal: "c Phillips b Boult" },
          { id: "pak_rizwan", runs: 48, balls: 36, fours: 4, sixes: 1, out: false },
        ],
        bowlers: [{ id: "nz_boult", balls: 24, maidens: 0, runs: 33, wickets: 2 }],
        overs: [],
        balls: [],
      },
    ],
  });
}

function scoreLine(match: CricketMatchState, side: "a" | "b"): string {
  const inn = [...match.innings].reverse().find((item) => item.team === side);
  if (!inn || (inn.legalBalls === 0 && inn.runs === 0 && match.status === "upcoming")) return "—";
  if (inn.legalBalls === 0 && inn.runs === 0) return "—";
  return `${inn.runs}/${inn.wickets} (${oversLabel(inn.legalBalls)})`;
}

function batterView(match: CricketMatchState, id: string | undefined, strike: boolean): BatterView | null {
  if (!id) return null;
  const inn = match.innings[match.current];
  const card = inn?.batters.find((b) => b.id === id);
  if (!card) return null;
  return { id, name: playerName(match, id), runs: card.runs, balls: card.balls, fours: card.fours, sixes: card.sixes, strike, look: lookOf(match, id, "bat") };
}

function bowlerView(match: CricketMatchState, id: string | undefined): BowlerView | null {
  if (!id) return null;
  const inn = match.innings[match.current];
  const card = inn?.bowlers.find((b) => b.id === id);
  if (!card) return { id, name: playerName(match, id), overs: "0.0", runs: 0, wickets: 0, economy: 0, look: lookOf(match, id, "bowl") };
  const economy = card.balls ? Math.round((card.runs / (card.balls / 6)) * 100) / 100 : 0;
  return { id, name: playerName(match, id), overs: oversLabel(card.balls), runs: card.runs, wickets: card.wickets, economy, look: lookOf(match, id, "bowl") };
}

function lookOf(match: CricketMatchState, id: string, fallback: RoleId): Cartoon {
  for (const side of ["a", "b"] as const) {
    const index = match.squads[side].findIndex((player) => player.id === id);
    if (index >= 0) {
      const player = match.squads[side][index];
      return castLook(player.id, player.role, match.teams[side].color, index);
    }
  }
  return castLook(id, fallback, "#e7ff4d", 0);
}

function partnership(inn: Innings): { runs: number; balls: number } {
  let runs = 0;
  let balls = 0;
  for (let i = inn.balls.length - 1; i >= 0; i--) {
    const ball = inn.balls[i];
    if (ball.wicket) break;
    runs += ball.runs;
    if (!ball.extraType) balls += 1;
  }
  return { runs, balls };
}

export function projectMatch(match: CricketMatchState, detail: boolean, now = Date.now(), lockMs = 800): MatchView {
  const inn = match.innings[match.current];
  const live =
    match.status === "live" && inn
      ? (() => {
          const crr = currentRunRate(inn.runs, inn.legalBalls);
          const rrr = requiredRunRate(match.target ?? null, inn.runs, inn.legalBalls, match.maxOvers);
          const chasing = match.target != null;
          const needRuns = chasing ? (match.target as number) - inn.runs : null;
          const ballsLeft = match.maxOvers * 6 - inn.legalBalls;
          const win = winProbability({
            batting: inn.team,
            innings: match.current + 1,
            runs: inn.runs,
            wickets: inn.wickets,
            legalBalls: inn.legalBalls,
            maxOvers: match.maxOvers,
            target: match.target ?? null,
            format: match.format,
          });
          return {
            batting: inn.team,
            runs: inn.runs,
            wickets: inn.wickets,
            overs: oversLabel(inn.legalBalls),
            crr,
            rrr,
            target: match.target ?? null,
            projected: projectedScore(inn.runs, inn.legalBalls, match.maxOvers, chasing),
            need:
              needRuns != null && needRuns > 0
                ? `${needRuns} needed off ${ballsLeft}`
                : needRuns != null
                  ? "Target reached"
                  : null,
            needHi:
              needRuns != null && needRuns > 0 ? `${ballsLeft} गेंद में ${needRuns} चाहिए` : needRuns != null ? "लक्ष्य पूरा" : null,
            win,
            striker: batterView(match, match.strikerId, true),
            nonStriker: batterView(match, match.nonStrikerId, false),
            bowler: bowlerView(match, match.bowlerId),
            partnership: partnership(inn),
            thisOver: (inn.overs[inn.overs.length - 1]?.balls || []).slice(-12),
            recent: inn.balls.slice(-12).map(ballToken),
            mood: teamMood(win[inn.team], inn.balls.slice(-6).map(ballToken)),
          };
        })()
      : null;

  const view: MatchView = {
    key: match.key,
    sport: "cricket",
    demo: match.demo,
    seriesKey: match.seriesKey,
    seriesName: match.seriesName,
    name: match.name,
    format: match.format,
    status: match.status,
    startAt: match.startAt,
    venue: match.venue,
    city: match.city,
    pitch: match.pitch,
    toss: match.toss,
    result: match.result,
    teams: match.teams,
    scoreline: { a: scoreLine(match, "a"), b: scoreLine(match, "b") },
    live,
    break: match.breakUntil && match.breakKind && now < match.breakUntil ? { kind: match.breakKind, until: match.breakUntil } : null,
  };

  if (!detail) return view;

  view.innings = match.innings.map((item) => ({
    team: item.team,
    title: match.teams[item.team].name,
    runs: item.runs,
    wickets: item.wickets,
    overs: oversLabel(item.legalBalls),
    extras: item.extras,
    batters: item.batters.map((b) => ({ ...b, name: playerName(match, b.id), look: lookOf(match, b.id, "bat") })),
    bowlers: item.bowlers.map((b) => ({
      ...b,
      name: playerName(match, b.id),
      overs: oversLabel(b.balls),
      economy: b.balls ? Math.round((b.runs / (b.balls / 6)) * 100) / 100 : 0,
      look: lookOf(match, b.id, "bowl"),
    })),
  }));
  const lastBalls = (inn?.balls || []).slice(-18).reverse();
  view.commentary = lastBalls.map((ball) => ({
    over: ball.extraType ? `${ball.over}.${ball.ballInOver || "wd"}` : `${ball.over}.${ball.ballInOver}`,
    text: ball.text,
    textHi: ball.textHi,
    kind: ball.wicket ? "WICKET" : ball.batRuns >= 6 ? "SIX" : ball.batRuns === 4 ? "FOUR" : "BALL",
  }));
  view.wagon = (inn?.balls || []).slice(-36).filter((b) => !b.extraType).map((b) => ({
    x: b.wagonX,
    y: b.wagonY,
    runs: b.batRuns,
    wicket: b.wicket,
  }));
  view.manhattan = match.innings.flatMap((item, idx) =>
    item.overs.map((over) => ({ over: over.n, runs: over.runs, wickets: over.wickets, innings: idx + 1 })),
  );
  view.worm = match.innings.flatMap((item, idx) => {
    let runs = 0;
    return item.overs.map((over) => {
      runs += over.runs;
      return { over: over.n, runs, innings: idx + 1 };
    });
  });
  view.xi = {
    a: match.squads.a.map((player, index) => ({ ...player, look: castLook(player.id, player.role, match.teams.a.color, index) })),
    b: match.squads.b.map((player, index) => ({ ...player, look: castLook(player.id, player.role, match.teams.b.color, index) })),
  };
  view.h2h = match.h2h;
  view.points = match.points;
  view.nextBallIndex = inn?.balls.length || 0;
  view.nextBallAt = match.nextBallAt;
  const onBreak = Boolean(match.breakUntil && now < match.breakUntil);
  const ballOpen = match.status === "live" && !onBreak && now + lockMs < match.nextBallAt;
  const at10 = inn && inn.legalBalls >= 60 ? inn.overs.slice(0, 10).reduce((sum, over) => sum + over.runs, 0) : null;
  view.overs10 = {
    open: match.status === "live" && !!inn && inn.legalBalls < 60 && !onBreak,
    innings: match.current,
    actual: at10,
  };
  const overOpen = ballOpen && !!inn && inn.legalBalls % 6 === 0;
  const matchOpen = match.status === "upcoming" && now < match.startAt;
  view.predictionOpen = { ball: ballOpen, over: overOpen, match: matchOpen };
  return view;
}

export function findPlayer(matches: CricketMatchState[], playerId: string): { player: Player; team?: Team } | null {
  for (const match of matches) {
    for (const side of ["a", "b"] as const) {
      const player = match.squads[side].find((p) => p.id === playerId);
      if (player) return { player, team: match.teams[side] };
    }
  }
  return null;
}

export interface SportModule {
  sport: Sport;
  implemented: boolean;
  summary: string;
}

export const SPORT_MODULES: SportModule[] = [
  { sport: "cricket", implemented: true, summary: "Live line, scorecards, predictions." },
  { sport: "football", implemented: false, summary: "Reserved. Add a provider that returns MatchProvider updates." },
  { sport: "kabaddi", implemented: false, summary: "Reserved. Roanuz covers Pro Kabaddi; wire a KabaddiProvider later." },
];

export interface MatchProvider {
  sport: Sport;
  id: string;
  loadAll(): Promise<CricketMatchState[]>;
}
