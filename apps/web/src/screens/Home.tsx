import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, haptic, t, type Match, type Me } from "../lib";
import { AdSlot } from "./Ad";
import { Avatar, STATUS_STICKER } from "../Avatar";

export function Home({ me }: { me: Me }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [series, setSeries] = useState<{ key: string; name: string }[]>([]);
  const [fav, setFav] = useState<string[]>([]);
  const nav = useNavigate();
  const lang = me.user.language;

  async function load() {
    const data = await api<{ matches: Match[]; series: { key: string; name: string }[]; favorites: { refKey: string }[] }>("/api/home");
    setMatches(data.matches);
    setSeries(data.series);
    setFav(data.favorites.map((f) => f.refKey));
  }
  useEffect(() => { load().catch(() => setMatches([])); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);

  const live = matches?.find((m) => m.status === "live");
  const shown = (matches || []).filter((m) => {
    if (filter === "live") return m.status === "live";
    if (filter === "upcoming") return m.status === "upcoming";
    if (filter === "recent") return m.status === "completed";
    if (filter.startsWith("s:")) return m.seriesKey === filter.slice(2);
    if (filter === "fav") return fav.includes(m.teams.a.key) || fav.includes(m.teams.b.key);
    return true;
  });

  return (
    <>
      <header className="top">
        <div className="brand">
          <button className="iconbtn" aria-label="Avatar" onClick={() => nav("/avatar")}><Avatar look={me.user.look} size={36} /></button>
          <div><b>LIVELINE</b><span>Pro · India</span></div>
        </div>
        <div className="flex items-center gap-2">
          <button className="lang" onClick={async () => { const next = lang === "hi" ? "en" : "hi"; await api("/api/auth/language", { method: "POST", body: JSON.stringify({ language: next }) }); location.reload(); }}>{lang === "hi" ? "EN" : "हिं"}</button>
          <button className="iconbtn" onClick={() => nav("/board")}>{me.user.points} {t(lang, "points")}</button>
          {me.user.admin && <button className="iconbtn" onClick={() => nav("/admin")}>Admin</button>}
        </div>
      </header>
      {me.channelUrl && (
        <button className="ghost w-full" onClick={() => {
          const url = me.channelUrl!;
          if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
          else window.open(url, "_blank", "noopener");
        }}>{t(lang, "join")} · @{me.channelUrl.replace(/^https?:\/\/t\.me\//, "")}</button>
      )}
      <button className="ghost w-full" style={{ boxShadow: `inset 3px 0 0 ${fanColor(me.user.fanTeamKey)}` }} onClick={() => nav("/pass")}>
        {me.user.rank?.name || t(lang, "pass")} · {me.user.dailyStreak || 0} day streak
      </button>
      {!matches && <><div className="skel" /><div className="skel" /></>}
      {live && (
        <button className="hero w-full text-left" onClick={() => { haptic("medium"); nav(`/match/${live.key}`); }}>
          <div className="row">
            <span className="livepill"><i className="dot" /> {STATUS_STICKER.live} {t(lang, "live")}</span>
            {live.live?.mood && <span className="demo">{live.live.mood.emoji} {lang === "hi" ? live.live.mood.labelHi : live.live.mood.label}</span>}
            <span className="demo">{live.demo ? t(lang, "demo") : live.seriesName}</span>
          </div>
          <div className="small mt-2">{live.teams.a.flag} {live.teams.a.code} {live.scoreline.a} · {live.teams.b.flag} {live.teams.b.code} {live.scoreline.b}</div>
          <div className="score" style={{ color: live.teams[live.live?.batting || "a"].color }}>{live.live ? `${live.live.runs}/${live.live.wickets}` : live.name}</div>
          <div className="need">{lang === "hi" ? live.live?.needHi : live.live?.need}</div>
          <div className="meta">{live.live?.overs} ov · {t(lang, "crr")} {live.live?.crr} · {t(lang, "rrr")} {live.live?.rrr ?? "—"}</div>
          {live.live && (
            <div className="win" aria-label={t(lang, "win")}>
              <i style={{ width: `${live.live.win.a}%`, background: live.teams.a.color }} />
              <i style={{ width: `${live.live.win.b}%`, background: live.teams.b.color }} />
            </div>
          )}
          <div className="pills">{(live.live?.recent || []).slice(-8).map((b, i) => <span key={i} className={pillClass(b)}>{b}</span>)}</div>
        </button>
      )}
      <div className="chips">
        {["all", "live", "upcoming", "recent", "fav"].map((key) => (
          <button key={key} className={`chip ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>{t(lang, key as "all")}</button>
        ))}
        {series.map((s) => <button key={s.key} className={`chip ${filter === `s:${s.key}` ? "on" : ""}`} onClick={() => setFilter(`s:${s.key}`)}>{s.name}</button>)}
      </div>
      <div className="chips">
        {(matches || []).flatMap((m) => [m.teams.a, m.teams.b]).filter((team, i, arr) => arr.findIndex((x) => x.key === team.key) === i).slice(0, 6).map((team) => (
          <button key={team.key} className={`chip ${fav.includes(team.key) ? "on" : ""}`} onClick={async () => {
            if (fav.includes(team.key)) await api("/api/favorites", { method: "DELETE", body: JSON.stringify({ kind: "team", refKey: team.key }) });
            else await api("/api/favorites", { method: "POST", body: JSON.stringify({ kind: "team", refKey: team.key, label: team.name }) });
            haptic("light");
            load();
          }}>{team.flag} {team.code}</button>
        ))}
      </div>
      {shown.filter((m) => m.key !== live?.key).map((m) => (
        <button key={m.key} className="listbtn" onClick={() => nav(`/match/${m.key}`)}>
          <div className="stripe" style={{ background: `linear-gradient(90deg, ${m.teams.a.color}, ${m.teams.b.color})` }} />
          <div className="row"><b>{m.name}</b><span className="small">{m.status === "live" ? t(lang, "live") : m.status === "completed" ? m.result : new Date(m.startAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</span></div>
          <div className="teams mt-1"><span>{m.teams.a.flag} {m.teams.a.code} {m.scoreline.a}</span><span>{m.teams.b.flag} {m.teams.b.code} {m.scoreline.b}</span></div>
        </button>
      ))}
      <AdSlot slot="home_native" />
      <button className="ghost w-full" onClick={() => nav("/advertise")}>{t(lang, "ads")}</button>
    </>
  );
}

const FAN_COLOR: Record<string, string> = {
  ind: "#ff7a18", aus: "#ffd200", eng: "#1a3cff", sa: "#007a4d", nz: "#c8c8c8", pak: "#1f8a4c",
};
function fanColor(key: string | null | undefined): string {
  if (!key) return "#e7ff4d";
  return FAN_COLOR[key] || "#e7ff4d";
}

export function pillClass(ball: string) {
  if (ball === "W") return "pill w";
  if (ball === "4") return "pill b4";
  if (ball === "6") return "pill b6";
  return "pill";
}
