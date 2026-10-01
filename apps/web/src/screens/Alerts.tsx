import { useEffect, useState } from "react";
import { api, t, toast } from "../lib";
import { Empty } from "../ui";

const TYPES = ["start", "wicket", "fifty", "hundred", "innings", "result", "prediction"];

export function AlertsPage({ lang }: { lang: string }) {
  const [matches, setMatches] = useState<any[]>([]);
  const [data, setData] = useState<any>({ reminders: [], history: [] });
  const [types, setTypes] = useState<string[]>(["start", "wicket", "result"]);
  const [minutes, setMinutes] = useState(30);
  async function load() {
    const home = await api<{ matches: any[] }>("/api/home");
    setMatches(home.matches);
    setData(await api("/api/reminders"));
  }
  const [failed, setFailed] = useState("");
  useEffect(() => { load().catch((e) => setFailed(e.message)); }, []);
  const upcoming = matches.filter((m) => m.status === "upcoming");
  return (
    <>
      <h2>{t(lang, "alerts")}</h2>
      <p className="small">Reminders are delivered by the bot and survive restarts.</p>
      <div className="chips">{TYPES.map((type) => <button key={type} className={`chip ${types.includes(type) ? "on" : ""}`} onClick={() => setTypes((cur) => cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type])}>{type}</button>)}</div>
      <div className="chips">{[15, 30, 60].map((m) => <button key={m} className={`chip ${minutes === m ? "on" : ""}`} onClick={() => setMinutes(m)}>{m} min</button>)}</div>
      {failed && <Empty icon="📡" title="Alerts didn't load" text={failed} cta="Retry" onCta={() => { setFailed(""); load().catch((e) => setFailed(e.message)); }} />}
      {!failed && upcoming.length === 0 && <Empty icon="📅" title="No upcoming matches yet" text="New fixtures show up here. Follow a team below to get alerts automatically." />}
      {upcoming.map((m) => (
        <button key={m.key} className="listbtn" onClick={async () => {
          await api("/api/reminders", { method: "POST", body: JSON.stringify({ matchKey: m.key, minutesBefore: minutes, alertTypes: types, startAt: m.startAt }) });
          toast(`🔔 Reminder set: ${m.name}, ${minutes} min before`);
          load();
        }}>🔔 {m.name} · {minutes}m before</button>
      ))}
      <h2>Follow</h2>
      {matches.slice(0, 2).map((m) => (
        <button key={m.teams.a.key} className="ghost" onClick={async () => {
          await api("/api/reminders", { method: "POST", body: JSON.stringify({ teamKey: m.teams.a.key, alertTypes: types }) });
          toast(`Following ${m.teams.a.name}`);
          load();
        }}>Follow {m.teams.a.name}</button>
      ))}
      <h2>Active</h2>
      {!(data.reminders || []).length && <p className="small">No reminders yet. Tap a match above and the bot will ping you.</p>}
      {(data.reminders || []).map((r: any) => (
        <div key={r.id} className="board">
          <span>{r.matchKey ? (matches.find((m) => m.key === r.matchKey)?.name || r.matchKey) : r.teamKey ? `Team · ${matches.flatMap((m) => [m.teams.a, m.teams.b]).find((tm) => tm.key === r.teamKey)?.name || r.teamKey}` : r.seriesKey}</span>
          <span className="small">{r.minutesBefore ? `${r.minutesBefore}m` : "alerts"}</span>
          <button onClick={async () => { await api(`/api/reminders/${r.id}`, { method: "DELETE" }); toast("Reminder removed"); load(); }}>Delete</button>
        </div>
      ))}
      <h2>History</h2>
      {!(data.history || []).length && <p className="small">Alerts the bot sends you will be listed here.</p>}
      {(data.history || []).map((n: any) => <div key={n.id} className="py-2"><b>{n.title}</b><div className="small">{n.body}</div></div>)}
    </>
  );
}
