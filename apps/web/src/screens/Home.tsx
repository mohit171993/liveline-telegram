import { useEffect, useState } from "react";
import { api, haptic, t, type Match, type Me } from "../lib";
import { AdSlot } from "./Ad";
import { Flag } from "../flags";
import { HeroCard, MatchCard, QuickRow, StreakBanner } from "../ui";

export function Home({ me }: { me: Me }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [series, setSeries] = useState<{ key: string; name: string }[]>([]);
  const [fav, setFav] = useState<string[]>([]);
  const lang = me.user.language === "hi" ? "hi" : "en";

  async function load() {
    const data = await api<{ matches: Match[]; series: { key: string; name: string }[]; favorites: { refKey: string }[] }>("/api/home");
    setMatches(data.matches);
    setSeries(data.series);
    setFav(data.favorites.map((f) => f.refKey));
  }
  useEffect(() => { load().catch(() => setMatches([])); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);

  const featured = [
    ...(matches || []).filter((m) => m.status === "live"),
    ...(matches || []).filter((m) => m.status === "upcoming"),
  ].slice(0, 5);
  const shown = (matches || []).filter((m) => {
    if (filter === "live") return m.status === "live";
    if (filter === "upcoming") return m.status === "upcoming";
    if (filter === "recent") return m.status === "completed";
    if (filter.startsWith("s:")) return m.seriesKey === filter.slice(2);
    if (filter === "fav") return fav.includes(m.teams.a.key) || fav.includes(m.teams.b.key);
    return true;
  });
  const teams = (matches || []).flatMap((m) => [m.teams.a, m.teams.b]).filter((team, i, arr) => arr.findIndex((x) => x.key === team.key) === i).slice(0, 8);

  return (
    <>
      {!matches && <><div className="skel hero-skel" /><div className="skel" /><div className="skel" /></>}
      {matches && featured.length > 0 && (
        <div className="hero-rail">
          {featured.map((match) => <HeroCard key={match.key} match={match} lang={lang} />)}
        </div>
      )}
      <QuickRow channelUrl={me.channelUrl} />
      <StreakBanner me={me} />
      <div className="chips">
        {["all", "live", "upcoming", "recent", "fav"].map((key) => (
          <button key={key} className={`chip ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>{t(lang, key as "all")}</button>
        ))}
        {series.map((s) => <button key={s.key} className={`chip ${filter === `s:${s.key}` ? "on" : ""}`} onClick={() => setFilter(`s:${s.key}`)}>{s.name}</button>)}
      </div>
      <div className="chips">
        {teams.map((team) => (
          <button key={team.key} className={`chip team ${fav.includes(team.key) ? "on" : ""}`} onClick={async () => {
            if (fav.includes(team.key)) await api("/api/favorites", { method: "DELETE", body: JSON.stringify({ kind: "team", refKey: team.key }) });
            else await api("/api/favorites", { method: "POST", body: JSON.stringify({ kind: "team", refKey: team.key, label: team.name }) });
            haptic("light");
            load();
          }}><Flag code={team.code} size={22} /> {team.code}</button>
        ))}
      </div>
      {shown.filter((m) => !featured.some((f) => f.key === m.key) || filter !== "all").map((m) => (
        <MatchCard key={m.key} match={m} />
      ))}
      <AdSlot slot="home_native" />
    </>
  );
}

export { pillClass } from "../ui";
