import { useEffect, useState } from "react";
import { api, t } from "../lib";
import { AdSlot } from "./Ad";
import { badgeSticker } from "../Avatar";

export function PassPage({ lang }: { lang: string }) {
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState("");
  async function load() { setData(await api("/api/engage")); }
  useEffect(() => { load().catch((e) => setNote(e.message)); }, []);
  if (!data) return <div className="skel" />;
  const rank = data.rank;
  return (
    <>
      <h2>{t(lang, "pass")}</h2>
      <p className="small">Free track. Points and XP only. Nothing here is paid.</p>
      <div className="card">
        <div className="row"><b>{rank.name}</b><span className="small">{data.xp} XP</span></div>
        <div className="meter" aria-label={`${rank.name} progress`}>
          <i style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
        <p className="small">{rank.next ? `Next: ${rank.next.name} at ${rank.next.min} XP` : "Legend. That's the top."}</p>
        <p className="small">Daily streak {data.dailyStreak} · Freeze {data.streakFreeze}</p>
      </div>
      <h2>{t(lang, "missions")}</h2>
      <AdSlot slot="mission" />
      {data.missions.map((m: any) => (
        <div key={m.key} className="card">
          <div className="row"><b>{lang === "hi" ? m.labelHi : m.label}</b><span className="small">{Math.min(m.progress, m.target)}/{m.target}</span></div>
          <button className="ghost" disabled={!m.done || m.claimed} onClick={async () => {
            const res = await api<any>(`/api/missions/${m.key}/claim`, { method: "POST" });
            setNote(`+${res.points} pts · +${res.xp} XP`);
            load();
          }}>{m.claimed ? "Claimed" : m.done ? "Claim" : "In progress"}</button>
        </div>
      ))}
      <h2>Season track</h2>
      <AdSlot slot="season_pass" />
      {data.tiers.map((tier: any) => (
        <div key={tier.tier} className="card">
          <span>{tier.tier}. {tier.label}</span>
          <button className="ghost" disabled={!tier.unlocked || tier.claimed} onClick={async () => {
            const res = await api<any>("/api/season/claim", { method: "POST", body: JSON.stringify({ tier: tier.tier }) });
            setNote(res.label);
            load();
          }}>{tier.claimed ? "Yours" : tier.unlocked ? "Claim" : `${tier.xp} XP`}</button>
        </div>
      ))}
      <h2>Achievements</h2>
      <div className="chips">
        {(data.badges || []).map((b: string) => <span key={b} className="chip on">{badgeSticker(b)} {b.split("_").join(" ")}</span>)}
        {!data.badges?.length && <span className="small">Play to earn the first one.</span>}
      </div>
      {note && <p className="small">{note}</p>}
    </>
  );
}
