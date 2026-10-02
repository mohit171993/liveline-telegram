import { realToss } from "./html";
import { containsBetting } from "@liveline/shared";
import { env } from "./env";
import { redis, type SiteMatch } from "./data";

/**
 * Lino match insights for the public site. Facts are derived from the same match view the Mini App
 * uses; when OPENAI_API_KEY is set, Lino adds a short AI "take" (same guardrails as the in-app buddy:
 * cricket only, no betting/odds/win-percentages), cached per match + over in Redis so traffic never
 * multiplies AI calls. The page never waits on the model.
 */
export interface Insight { icon: string; text: string }

const sr = (r: number, b: number) => (b ? ((r * 100) / b).toFixed(0) : "0");

export function linoFacts(m: SiteMatch): Insight[] {
  const out: Insight[] = [];
  const A = m.teams.a, B = m.teams.b;
  const live = m.live;
  if (m.status === "live" && live) {
    const bat = m.teams[live.batting];
    out.push({ icon: "⚡", text: `${bat.name} are ${live.runs}/${live.wickets} after ${live.overs} overs (run rate ${live.crr.toFixed(2)}).` });
    if (live.need) out.push({ icon: "🎯", text: `${live.need}${live.rrr != null ? ` — required rate ${live.rrr.toFixed(2)}` : ""}.` });
    else if (live.projected) out.push({ icon: "📈", text: `At the current rate the innings would finish around ${live.projected}.` });
    if (live.partnership.balls) out.push({ icon: "🤝", text: `Current stand: ${live.partnership.runs} off ${live.partnership.balls} balls.` });
    if (live.striker) out.push({ icon: "🏏", text: `${live.striker.name} ${live.striker.runs} (${live.striker.balls}) — strike rate ${sr(live.striker.runs, live.striker.balls)}, ${live.striker.fours}×4, ${live.striker.sixes}×6.` });
    if (live.bowler) out.push({ icon: "🎳", text: `${live.bowler.name}: ${live.bowler.wickets}/${live.bowler.runs} in ${live.bowler.overs} overs (economy ${live.bowler.economy.toFixed(1)}).` });
    const recent = live.recent.slice(-12);
    if (recent.length >= 6) {
      const bnd = recent.filter((b) => /^(4|6)/.test(b)).length;
      const wk = recent.filter((b) => /W/i.test(b)).length;
      const dots = recent.filter((b) => b === "0" || b === "·").length;
      out.push({ icon: "🔁", text: `Last ${recent.length} balls: ${bnd} boundar${bnd === 1 ? "y" : "ies"}, ${wk} wicket${wk === 1 ? "" : "s"}, ${dots} dot${dots === 1 ? "" : "s"}.` });
    }
  } else if (m.status === "upcoming") {
    out.push({ icon: "📍", text: `${m.venue}${m.city ? `, ${m.city}` : ""}.` });
    if (m.pitch) out.push({ icon: "🌱", text: `Pitch: ${m.pitch}` });
    if (realToss(m.toss)) out.push({ icon: "🪙", text: m.toss! });
    if (m.h2h?.played) out.push({ icon: "📊", text: `Head-to-head: ${m.h2h.played} played — ${A.code} ${m.h2h.aWins}, ${B.code} ${m.h2h.bWins}.${m.h2h.last ? ` Last time: ${m.h2h.last}.` : ""}` });
  } else {
    if (m.result) out.push({ icon: "🏁", text: m.result });
  }
  for (const inn of m.status === "upcoming" ? [] : m.innings || []) {
    const top = [...inn.batters].sort((x, y) => y.runs - x.runs)[0];
    const best = [...inn.bowlers].sort((x, y) => y.wickets - x.wickets || x.runs - y.runs)[0];
    if (top && top.runs >= 20) out.push({ icon: "⭐", text: `${inn.title}: top score ${top.name} ${top.runs} (${top.balls}).` });
    if (best && best.wickets >= 2) out.push({ icon: "🔥", text: `${inn.title}: best bowling ${best.name} ${best.wickets}/${best.runs}.` });
  }
  return out.slice(0, 7);
}

function stamp(m: SiteMatch): string {
  if (m.status === "live" && m.live) return `${m.live.batting}-${String(m.live.overs).split(".")[0]}-${m.live.wickets}`;
  return m.status;
}

const inflight = new Set<string>();

/** Cached AI take, or null. Kicks off a background refresh when stale. */
export async function linoTake(m: SiteMatch): Promise<string | null> {
  if (!env.openaiKey || !env.linoAi) return null;
  const key = `ll:site:lino:${m.key}:${stamp(m)}`;
  let cached: string | null = null;
  try { cached = await redis.get(key); } catch { /* ignore */ }
  if (!cached && !inflight.has(key)) {
    inflight.add(key);
    void generate(m).then(async (text) => {
      if (text) await redis.set(key, text, "EX", m.status === "live" ? 900 : 6 * 3600);
    }).catch(() => undefined).finally(() => inflight.delete(key));
  }
  if (!cached) {
    // Fall back to the latest take for this match (previous over) while the new one is generated.
    try { cached = await redis.get(`ll:site:lino:${m.key}:latest`); } catch { /* ignore */ }
  }
  return cached;
}

async function generate(m: SiteMatch): Promise<string | null> {
  const facts = {
    name: m.name, status: m.status, series: m.seriesName, venue: m.venue, pitch: m.pitch, toss: m.toss, result: m.result,
    scoreline: m.scoreline, live: m.live && { ...m.live, striker: m.live.striker && { ...m.live.striker, look: undefined }, nonStriker: undefined, bowler: m.live.bowler && { ...m.live.bowler, look: undefined } },
    h2h: m.h2h,
    innings: (m.innings || []).map((i) => ({ title: i.title, score: `${i.runs}/${i.wickets} (${i.overs})`, top: i.batters.slice().sort((a, b) => b.runs - a.runs).slice(0, 2).map((b) => `${b.name} ${b.runs}(${b.balls})`), bowl: i.bowlers.slice().sort((a, b) => b.wickets - a.wickets).slice(0, 2).map((b) => `${b.name} ${b.wickets}/${b.runs}`) })),
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctl.signal,
      headers: { authorization: `Bearer ${env.openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.openaiModel,
        temperature: 0.4,
        max_tokens: 160,
        messages: [
          { role: "system", content: "You are Lino, LiveLinePro's friendly cricket buddy. Write a 2-3 sentence match insight for fans (under 60 words, English). Use only the facts given. Never mention betting, odds, sessions, win percentages, probabilities, prizes or money. No predictions of who will win." },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim() || "";
    if (!text || containsBetting(text) || /\d+\s*%|percent|probab|chance/i.test(text)) return null;
    await redis.set(`ll:site:lino:${m.key}:latest`, text, "EX", 6 * 3600).catch(() => undefined);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
