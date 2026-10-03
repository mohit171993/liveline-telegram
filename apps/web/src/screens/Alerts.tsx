import { useEffect, useMemo, useState } from "react";
import { api, haptic, t, toast } from "../lib";
import { Empty } from "../ui";
import { TeamBadge } from "./MatchPreview";

const TYPES = ["start", "wicket", "fifty", "hundred", "innings", "result", "prediction"];
const LABEL: Record<string, string> = { start: "🟢 Start", wicket: "☝️ Wicket", fifty: "5️⃣0️⃣ Fifty", hundred: "💯 Hundred", innings: "🔁 Innings", result: "🏆 Result", prediction: "🎯 Predict" };
const when = (at: number) => new Date(at).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function AlertsPage({ lang }: { lang: string }) {
  const [matches, setMatches] = useState<any[] | null>(null);
  const [data, setData] = useState<any>({ reminders: [], history: [] });
  const [types, setTypes] = useState<string[]>(["start", "wicket", "result"]);
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState("");
  async function load() {
    const [home, rem] = await Promise.all([api<{ matches: any[] }>("/api/home"), api("/api/reminders")]);
    setMatches(home.matches);
    setData(rem);
  }
  const [failed, setFailed] = useState("");
  useEffect(() => { load().catch((e) => setFailed(e.message)); }, []);
  const upcoming = (matches || []).filter((m) => m.status === "upcoming");
  const reminders: any[] = data.reminders || [];
  const byMatch = new Map(reminders.filter((r) => r.matchKey).map((r) => [r.matchKey, r]));
  const byTeam = new Map(reminders.filter((r) => r.teamKey).map((r) => [r.teamKey, r]));
  const teams = useMemo(() => {
    const seen = new Map<string, any>();
    for (const m of upcoming) for (const tm of [m.teams.a, m.teams.b]) if (!seen.has(tm.key)) seen.set(tm.key, tm);
    return [...seen.values()].slice(0, 12);
  }, [matches]);

  async function toggleMatch(m: any) {
    haptic("medium"); setBusy(m.key);
    try {
      const r = byMatch.get(m.key);
      if (r) { await api(`/api/reminders/${r.id}`, { method: "DELETE" }); toast("🔕 Reminder removed"); }
      else { await api("/api/reminders", { method: "POST", body: JSON.stringify({ matchKey: m.key, minutesBefore: minutes, alertTypes: types, startAt: m.startAt }) }); toast(`🔔 ${m.teams.a.code} vs ${m.teams.b.code}: ${minutes} min before`); }
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't save", "err"); }
    setBusy("");
  }
  async function toggleTeam(tm: any) {
    haptic("light"); setBusy(tm.key);
    try {
      const r = byTeam.get(tm.key);
      if (r) { await api(`/api/reminders/${r.id}`, { method: "DELETE" }); toast(`Unfollowed ${tm.name}`); }
      else { await api("/api/reminders", { method: "POST", body: JSON.stringify({ teamKey: tm.key, alertTypes: types }) }); toast(`⭐ Following ${tm.name}`); }
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't save", "err"); }
    setBusy("");
  }

  return (
    <>
      <div className="page-head"><h2>{t(lang, "alerts")}</h2><span className="chip on" aria-label="Active reminders">🔔 {reminders.length}</span></div>
      <p className="small">The bot pings you in Telegram. Pick what you want, then tap a match.</p>
      <section className="pv-card">
        <h3 className="pv-title">What to send</h3>
        <div className="chips">{TYPES.map((type) => <button key={type} className={`chip ${types.includes(type) ? "on" : ""}`} aria-pressed={types.includes(type)} onClick={() => { haptic("light"); setTypes((cur) => cur.includes(type) ? (cur.length > 1 ? cur.filter((x) => x !== type) : cur) : [...cur, type]); }}>{LABEL[type] || type}</button>)}</div>
        <h3 className="pv-title" style={{ marginTop: 12 }}>Remind me before the start</h3>
        <div className="chips">{[15, 30, 60].map((m) => <button key={m} className={`chip ${minutes === m ? "on" : ""}`} aria-pressed={minutes === m} onClick={() => { haptic("light"); setMinutes(m); }}>{m} min</button>)}</div>
      </section>
      {failed && <Empty icon="📡" title="Alerts didn't load" text={failed} cta="Retry" onCta={() => { setFailed(""); load().catch((e) => setFailed(e.message)); }} />}
      {!failed && !matches && <><div className="skel" /><div className="skel" /></>}
      {!failed && matches && upcoming.length === 0 && <Empty icon="📅" title="No upcoming matches yet" text="New fixtures show up here. Follow a team below to get alerts automatically." />}
      {upcoming.length > 0 && <h3 className="pv-title al-h">Upcoming matches</h3>}
      {upcoming.map((m) => {
        const on = byMatch.has(m.key);
        return (
          <button key={m.key} type="button" className={`al-match ${on ? "on" : ""}`} disabled={busy === m.key} aria-pressed={on} onClick={() => toggleMatch(m)}>
            <span className="al-badges"><TeamBadge team={m.teams.a} size={34} /><TeamBadge team={m.teams.b} size={34} /></span>
            <span className="al-txt"><b>{m.teams.a.code} vs {m.teams.b.code}</b><span className="small">{when(m.startAt)} IST · {m.seriesName}</span></span>
            <span className={`al-bell ${on ? "on" : ""}`} aria-hidden="true">{on ? "🔔" : "＋"}</span>
          </button>
        );
      })}
      {teams.length > 0 && <>
        <h3 className="pv-title al-h">Follow a team</h3>
        <p className="small">Every match of the team, automatically.</p>
        <div className="chips">{teams.map((tm) => <button key={tm.key} type="button" disabled={busy === tm.key} className={`chip ${byTeam.has(tm.key) ? "on" : ""}`} aria-pressed={byTeam.has(tm.key)} onClick={() => toggleTeam(tm)}>{byTeam.has(tm.key) ? "⭐ " : ""}{tm.name}</button>)}</div>
      </>}
      <h3 className="pv-title al-h">Active reminders</h3>
      {!reminders.length && <p className="small">No reminders yet. Tap a match above and the bot will ping you.</p>}
      {reminders.map((r: any) => {
        const m = (matches || []).find((x) => x.key === r.matchKey);
        const tm = (matches || []).flatMap((x) => [x.teams.a, x.teams.b]).find((x) => x.key === r.teamKey);
        const label = r.matchKey ? (m ? `${m.teams.a.code} vs ${m.teams.b.code}` : "Match") : r.teamKey ? `⭐ ${tm?.name || "Team"}` : "Series";
        return (
          <div key={r.id} className="board al-row">
            <span><b>{label}</b><span className="small"> · {r.minutesBefore ? `${r.minutesBefore} min before` : "all alerts"}</span></span>
            <button type="button" className="ghost" onClick={async () => { haptic("light"); try { await api(`/api/reminders/${r.id}`, { method: "DELETE" }); toast("Reminder removed"); await load(); } catch (e) { toast(e instanceof Error ? e.message : "Couldn't remove", "err"); } }}>Remove</button>
          </div>
        );
      })}
      <h3 className="pv-title al-h">History</h3>
      {!(data.history || []).length && <p className="small">Alerts the bot sends you will be listed here.</p>}
      {(data.history || []).map((n: any) => <div key={n.id} className="pv-card al-hist"><b>{n.title}</b><div className="small">{n.body}</div></div>)}
    </>
  );
}
