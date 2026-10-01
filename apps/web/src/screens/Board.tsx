import { useEffect, useState } from "react";
import { api, t, type Me } from "../lib";

export function BoardPage({ lang, me }: { lang: string; me: Me }) {
  const [scope, setScope] = useState("daily");
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api(`/api/leaderboard?scope=${scope}&matchKey=demo_ind_aus`).then(setData);
  }, [scope]);
  return (
    <>
      <h2>{t(lang, "board")}</h2>
      <div className="chips">
        {["daily", "match", "season"].map((s) => <button key={s} className={`chip ${scope === s ? "on" : ""}`} onClick={() => setScope(s)}>{s}</button>)}
      </div>
      <p className="small">Streak {me.user.streak} · {me.user.points} {t(lang, "points")}</p>
      {(data?.badges || []).map((b: any) => <span key={b.id} className="chip on">{b.badgeKey}</span>)}
      {(data?.rows || []).map((row: any) => (
        <div key={row.userId} className={`rank ${row.you ? "you" : ""}`}><span>{row.rank} {row.name}</span><b>{row.points}</b></div>
      ))}
      <AdNote />
    </>
  );
}

function AdNote() {
  return <p className="small mt-4">Sponsored boards can be branded. The points stay free.</p>;
}
