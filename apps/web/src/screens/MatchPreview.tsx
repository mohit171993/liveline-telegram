import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, haptic, toast, type Match, type Player } from "../lib";
import { Flag, hasFlag } from "../flags";

/** Real pre-match data only (see @liveline/shared buildMatchPreview); empty blocks are hidden. */
type Form = { r: "W" | "L" | "T"; vs: string; key: string; at: number };
type Preview = {
  form: { a: Form[]; b: Form[] };
  h2h: { played: number; aWins: number; bWins: number; ties: number; last: { key: string; at: number; winner: string; result: string }[] } | null;
  venue: { matches: number; avgFirst: number; highestFirst: number; chasesWon: number; defendsWon: number } | null;
  standings: { team: string; side: "a" | "b" | null; p: number; w: number; l: number; nrr: string; pts: number; pos: number }[];
  reminder: { id: string; minutesBefore: number | null } | null;
};

const BOT = "LiveLineProBot";
const IST = "Asia/Kolkata";

/** Stable team colours from the team key (the provider gives no brand colours). */
function teamHue(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
function initials(name: string, code: string): string {
  const words = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : code.slice(0, 2)).toUpperCase();
}

export function TeamBadge({ team, size = 64 }: { team: Match["teams"]["a"]; size?: number }) {
  if (hasFlag(team.code, team.name)) return <span className="pv-flag" style={{ width: size, height: size }}><Flag code={team.code} size={Math.round(size * 0.78)} /></span>;
  const h = teamHue(team.key || team.name);
  return (
    <span className="pv-mono" style={{ width: size, height: size, fontSize: size * 0.34, background: `linear-gradient(140deg, hsl(${h} 85% 58%), hsl(${(h + 40) % 360} 80% 38%))`, boxShadow: `0 0 0 2px hsl(${h} 90% 70% / .55), 0 10px 28px hsl(${h} 90% 50% / .35)` }} aria-label={team.name}>
      {initials(team.name, team.code)}
    </span>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

function Countdown({ to }: { to: number }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.floor((to - now) / 1000));
  const parts = [
    { k: "Days", v: Math.floor(left / 86400) },
    { k: "Hrs", v: Math.floor((left % 86400) / 3600) },
    { k: "Min", v: Math.floor((left % 3600) / 60) },
    { k: "Sec", v: left % 60 },
  ].filter((p, i) => i > 0 || p.v > 0);
  if (left <= 0) return <div className="pv-soon"><i className="dot" /> Starting any moment</div>;
  return (
    <div className="pv-count" role="timer" aria-label="Time to start">
      {parts.map((p) => (
        <div key={p.k} className="pv-unit">
          <b key={`${p.k}${p.v}`} className="pv-num">{String(p.v).padStart(2, "0")}</b>
          <span>{p.k}</span>
        </div>
      ))}
    </div>
  );
}

const fmtTime = (at: number, tz?: string) => new Date(at).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
const shortTz = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || tz;

function FormDots({ list }: { list: Form[] }) {
  return <div className="pv-dots">{list.map((f) => <i key={f.key} className={`pv-dot ${f.r}`} title={`${f.r} vs ${f.vs}`}>{f.r}</i>)}</div>;
}

const ROLE: Record<string, string> = { wk: "Keeper", bat: "Batters", all: "All-rounders", bowl: "Bowlers" };

function Squad({ title, players }: { title: string; players: Player[] }) {
  const groups = (["wk", "bat", "all", "bowl"] as const).map((r) => ({ r, list: players.filter((p) => (p.role || "bat") === r) })).filter((g) => g.list.length);
  return (
    <div className="pv-squad">
      <b className="pv-squad-t">{title} <span className="muted">· {players.length}</span></b>
      {groups.map((g) => (
        <div key={g.r} className="pv-role"><span className="tiny muted">{ROLE[g.r]}</span>
          <div className="pv-names">{g.list.map((p) => <span key={p.id}>{p.name.trim()}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

export function UpcomingPreview({ match }: { match: Match }) {
  const nav = useNavigate();
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [squadOpen, setSquadOpen] = useState(false);
  const [lino, setLino] = useState<{ text: string; err?: boolean } | null>(null);
  const [linoBusy, setLinoBusy] = useState(false);
  const { a, b } = match.teams;

  const load = () => api<Preview>(`/api/matches/${match.key}/preview`).then(setPv).catch(() => setPv(null));
  useEffect(() => { load(); }, [match.key]);

  const localTz = tzName();
  const showLocal = localTz && localTz !== IST && shortTz(localTz) !== "GMT+5:30";
  const tossAt = match.startAt - 30 * 60_000;
  const xiA = match.xi?.a || [], xiB = match.xi?.b || [];
  const squadWord = (n: number) => (n > 0 && n <= 11 ? "Playing XI" : "Squad");
  const standings = pv?.standings || [];
  const mine = useMemo(() => standings.filter((s) => s.side), [standings]);

  async function remind() {
    haptic("medium");
    setBusy(true);
    try {
      if (pv?.reminder) {
        await api(`/api/reminders/${pv.reminder.id}`, { method: "DELETE" });
        toast("🔕 Reminder removed");
      } else {
        await api("/api/reminders", { method: "POST", body: JSON.stringify({ matchKey: match.key, minutesBefore: 30, alertTypes: ["start", "wicket", "result"], startAt: match.startAt }) });
        toast("🔔 We'll ping you 30 min before, plus wickets and the result");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      }
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't save the reminder", "err"); }
    setBusy(false);
  }
  function share() {
    haptic("light");
    const link = `https://t.me/${BOT}?startapp=${encodeURIComponent(`match_${match.key}`).slice(0, 64)}`;
    const text = `🏏 ${a.name} vs ${b.name} · ${match.seriesName}\n⏰ ${fmtTime(match.startAt, IST)} IST\nLive line, alerts and free predictions on LiveLinePro:`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp as any;
    if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank", "noopener");
  }
  async function askLino() {
    haptic("light");
    setLinoBusy(true);
    try {
      const res = await api<{ text: string }>("/api/ai/chat", { method: "POST", body: JSON.stringify({ matchKey: match.key, message: `Give me a short pre-match preview of ${a.name} vs ${b.name}: conditions, key players to watch and what to look out for. No betting.` }) });
      setLino({ text: res.text });
    } catch (e) { setLino({ text: e instanceof Error ? e.message : "Lino is resting. Try again soon.", err: true }); }
    setLinoBusy(false);
  }

  return (
    <>
      <section className="pv-hero" aria-label="Match preview">
        <div className="pv-glow" aria-hidden="true" />
        <div className="pv-top">
          <span className="pv-series">{match.seriesName}</span>
          <span className="pv-chips"><span className="pv-chip">{match.format}</span><span className="pv-chip up">⏳ Upcoming</span></span>
        </div>
        <div className="pv-teams">
          <div className="pv-team"><TeamBadge team={a} /><b>{a.name}</b><span>{a.code}</span>{pv && pv.form.a.length > 0 && <FormDots list={pv.form.a} />}</div>
          <div className="pv-vs" aria-hidden="true">VS</div>
          <div className="pv-team"><TeamBadge team={b} /><b>{b.name}</b><span>{b.code}</span>{pv && pv.form.b.length > 0 && <FormDots list={pv.form.b} />}</div>
        </div>
        <Countdown to={match.startAt} />
        <div className="pv-when">
          <span>🕒 {fmtTime(match.startAt, IST)} <b>IST</b></span>
          {showLocal && <span className="muted">{fmtTime(match.startAt)} your time ({shortTz(localTz)})</span>}
        </div>
        {(match.venue || match.city) && <div className="pv-venue">📍 {[match.venue, match.city].filter(Boolean).join(", ")}</div>}
        <div className="pv-actions">
          <button type="button" className={`pv-btn primary ${pv?.reminder ? "set" : ""}`} disabled={busy} onClick={remind} aria-pressed={Boolean(pv?.reminder)}>
            {pv?.reminder ? "🔔 Reminder on" : "🔔 Remind me"}
          </button>
          <button type="button" className="pv-btn" onClick={share}>↗ Share</button>
        </div>
      </section>

      <button type="button" className="pv-card pv-predict" onClick={() => { haptic("light"); nav(`/predict/${match.key}`); }}>
        <span className="pv-ico" aria-hidden="true">🎯</span>
        <span><b>Predict the winner</b><span className="small">Free · points only, for the leaderboard. No money, ever.</span></span>
        <span className="pv-go" aria-hidden="true">›</span>
      </button>

      <section className="pv-card pv-lino">
        <div className="pv-h"><img src="/brand/mascot.svg" alt="" width={40} height={40} /><div><b>Lino's preview</b><span className="small">AI cricket buddy · uses your daily Lino questions</span></div></div>
        {lino ? <p className={`pv-lino-text ${lino.err ? "err" : ""}`}>{lino.text}</p> : <p className="small">Ask Lino for a quick read on conditions, form and the players to watch.</p>}
        <div className="pv-actions">
          {!lino && <button type="button" className="pv-btn primary" disabled={linoBusy} onClick={askLino}>{linoBusy ? "Lino is thinking…" : "✨ Get Lino's preview"}</button>}
          <button type="button" className="pv-btn" onClick={() => { haptic("light"); nav(`/ai/${match.key}`); }}>💬 Ask Lino</button>
        </div>
      </section>

      <section className="pv-card">
        <div className="pv-row"><span className="pv-ico sm" aria-hidden="true">🪙</span>
          {match.toss
            ? <span><b>Toss</b><span className="small">{match.toss}</span></span>
            : <span><b>Toss around {new Date(tossAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: IST })} IST</b><span className="small">Usually 30 min before the start. We'll show it here the moment it happens.</span></span>}
        </div>
      </section>

      {pv?.h2h && (
        <section className="pv-card">
          <h3 className="pv-title">Head to head <span className="muted">· last {pv.h2h.played} we tracked</span></h3>
          <div className="pv-h2h">
            <div><b>{pv.h2h.aWins}</b><span>{a.code}</span></div>
            <div className="pv-bar"><i style={{ flex: pv.h2h.aWins || 0.0001, background: `hsl(${teamHue(a.key)} 85% 58%)` }} /><i style={{ flex: pv.h2h.ties || 0.0001, background: "var(--muted)" }} /><i style={{ flex: pv.h2h.bWins || 0.0001, background: `hsl(${teamHue(b.key)} 85% 58%)` }} /></div>
            <div><b>{pv.h2h.bWins}</b><span>{b.code}</span></div>
          </div>
          {pv.h2h.last.map((m) => <p key={m.key} className="small">{new Date(m.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {m.result || `${m.winner} won`}</p>)}
        </section>
      )}

      {mine.length > 0 && (
        <section className="pv-card">
          <h3 className="pv-title">Standings <span className="muted">· {match.seriesName}</span></h3>
          <div className="pv-table" role="table">
            <div className="pv-tr head" role="row"><span>#</span><span>Team</span><span>P</span><span>W</span><span>L</span><span>NRR</span><span>Pts</span></div>
            {standings.map((s) => (
              <div key={s.team} role="row" className={`pv-tr ${s.side ? "me" : ""}`}><span>{s.pos}</span><span className="pv-tn">{s.team}</span><span>{s.p}</span><span>{s.w}</span><span>{s.l}</span><span>{s.nrr}</span><b>{s.pts}</b></div>
            ))}
          </div>
        </section>
      )}

      {pv?.venue && (
        <section className="pv-card">
          <h3 className="pv-title">Venue stats <span className="muted">· {pv.venue.matches} recent matches here</span></h3>
          <div className="pv-stats">
            <div><b>{pv.venue.avgFirst}</b><span>Avg 1st innings</span></div>
            <div><b>{pv.venue.highestFirst}</b><span>Highest 1st inns</span></div>
            <div><b>{pv.venue.defendsWon}–{pv.venue.chasesWon}</b><span>Defended–chased</span></div>
          </div>
        </section>
      )}

      {(xiA.length > 0 || xiB.length > 0) && (
        <section className="pv-card">
          <button type="button" className="pv-expand" aria-expanded={squadOpen} onClick={() => { haptic("light"); setSquadOpen(!squadOpen); }}>
            <span><b>{squadWord(Math.max(xiA.length, xiB.length))}s</b><span className="small">{a.code} {xiA.length} · {b.code} {xiB.length} players</span></span>
            <span className={`pv-chev ${squadOpen ? "open" : ""}`} aria-hidden="true">⌄</span>
          </button>
          {squadOpen && <div className="pv-squads">{xiA.length > 0 && <Squad title={a.name} players={xiA} />}{xiB.length > 0 && <Squad title={b.name} players={xiB} />}</div>}
        </section>
      )}
    </>
  );
}
