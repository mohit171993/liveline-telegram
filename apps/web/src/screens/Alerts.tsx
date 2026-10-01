import { useEffect, useState } from "react";
import { api, t } from "../lib";

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
  useEffect(() => { load().catch(() => undefined); }, []);
  return (
    <>
      <h2>{t(lang, "alerts")}</h2>
      <p className="small">Reminders are delivered by the bot and survive restarts.</p>
      <div className="chips">{TYPES.map((type) => <button key={type} className={`chip ${types.includes(type) ? "on" : ""}`} onClick={() => setTypes((cur) => cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type])}>{type}</button>)}</div>
      <div className="chips">{[15, 30, 60].map((m) => <button key={m} className={`chip ${minutes === m ? "on" : ""}`} onClick={() => setMinutes(m)}>{m} min</button>)}</div>
      {matches.filter((m) => m.status === "upcoming").map((m) => (
        <button key={m.key} className="listbtn" onClick={async () => {
          await api("/api/reminders", { method: "POST", body: JSON.stringify({ matchKey: m.key, minutesBefore: minutes, alertTypes: types, startAt: m.startAt }) });
          load();
        }}>{m.name} · {minutes}m before</button>
      ))}
      <h2>Follow</h2>
      {matches.slice(0, 2).map((m) => (
        <button key={m.teams.a.key} className="ghost" onClick={async () => {
          await api("/api/reminders", { method: "POST", body: JSON.stringify({ teamKey: m.teams.a.key, alertTypes: types }) });
          load();
        }}>Follow {m.teams.a.name}</button>
      ))}
      <h2>Active</h2>
      {(data.reminders || []).map((r: any) => (
        <div key={r.id} className="board">
          <span>{r.matchKey || r.teamKey || r.seriesKey}</span>
          <span className="small">{r.minutesBefore ? `${r.minutesBefore}m` : "alerts"}</span>
          <button onClick={async () => { await api(`/api/reminders/${r.id}`, { method: "DELETE" }); load(); }}>Delete</button>
        </div>
      ))}
      <h2>History</h2>
      {(data.history || []).map((n: any) => <div key={n.id} className="py-2"><b>{n.title}</b><div className="small">{n.body}</div></div>)}
    </>
  );
}
