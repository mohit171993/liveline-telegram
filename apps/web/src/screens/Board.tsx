import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, t, type Me } from "../lib";
import { Avatar, badgeSticker, type Look } from "../Avatar";
import { Empty } from "../ui";

const SCOPES = [
  { key: "week", label: "This week" },
  { key: "daily", label: "Today" },
  { key: "match", label: "Match" },
  { key: "season", label: "All time" },
];

export function BoardPage({ lang, me }: { lang: string; me: Me }) {
  const nav = useNavigate();
  const [scope, setScope] = useState("week");
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState("");
  const [match, setMatch] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    api<{ matches: any[] }>("/api/home").then(({ matches }) => {
      const m = matches.find((x) => x.status === "live") || matches.find((x) => x.status === "upcoming") || matches[0];
      if (m) setMatch({ key: m.key, label: `${m.teams.a.code} v ${m.teams.b.code}` });
    }).catch(() => undefined);
  }, []);

  async function load() {
    setFailed("");
    try {
      const apiScope = scope === "week" ? "daily" : scope;
      const q = scope === "match" && match ? `&matchKey=${encodeURIComponent(match.key)}` : "";
      setData(await api(`/api/leaderboard?scope=${apiScope}${q}`));
    } catch (e: any) { setFailed(e.message); }
  }
  useEffect(() => { setData(null); load(); }, [scope, match?.key]);

  const league = data?.league;
  const rows: { rank: number; name: string; points: number; you?: boolean; look?: Look; userId?: string }[] =
    scope === "week" ? (league?.rows || []).filter((r: any) => r.points > 0) : (data?.rows || []);

  return (
    <>
      <h2>{t(lang, "board")}</h2>
      <div className="chips">
        {SCOPES.map((s) => <button key={s.key} className={`chip ${scope === s.key ? "on" : ""}`} onClick={() => setScope(s.key)}>{s.key === "match" && match ? `🏏 ${match.label}` : s.label}</button>)}
      </div>
      {scope === "week" && league && (
        <div className="card">
          <div className="row"><b>🏆 {league.name} league</b><span className="small">Tier {league.tier}/10</span></div>
          <p className="small">You: {league.points} pts · rank {league.rank} · {league.outcome === "promote" ? "promotion zone" : league.outcome === "relegate" ? "relegation zone" : "safe"}. Resets every Monday. Points only.</p>
        </div>
      )}
      <p className="small">Your streak {me.user.streak} · {me.user.points} {t(lang, "points")}</p>
      {(data?.badges || []).length > 0 && (
        <div className="chips">{data.badges.map((b: any) => <span key={b.id} className="chip on">{badgeSticker(b.badgeKey)} {b.badgeKey.split("_").join(" ")}</span>)}</div>
      )}
      {failed && <Empty icon="📡" title="Board didn't load" text={failed} cta="Retry" onCta={load} />}
      {!failed && !data && <><div className="skel" /><div className="skel" /></>}
      {!failed && data && rows.length === 0 && (
        <Empty icon="🥇" title="Be the first on the board" text={scope === "match" ? "Nobody has scored on this match yet. Call the next ball to get on top." : "No points yet. Make a free prediction and claim the top spot."} cta="🎯 Predict now" onCta={() => nav("/predict")} />
      )}
      {rows.map((row) => (
        <div key={row.userId || `${row.rank}-${row.name}`} className={`lb-row ${row.you ? "you" : ""}`}>
          <span className="lb-rank">{row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}</span>
          {row.look ? <Avatar look={row.look} size={36} /> : <span className="empty-icon" style={{ fontSize: 24 }}>🧢</span>}
          <b>{row.name}{row.you ? " (you)" : ""}</b>
          <span className="lb-pts">{row.points}</span>
        </div>
      ))}
      <p className="small mt-4">Sponsored boards can be branded. The points stay free.</p>
    </>
  );
}
