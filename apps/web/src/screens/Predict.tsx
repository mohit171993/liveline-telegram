import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, haptic, t } from "../lib";
import { AdSlot } from "./Ad";

const PICKS = ["dot", "1", "2", "3", "4", "6", "wicket", "extra"];

export function PredictPage({ lang }: { lang: string }) {
  const params = useParams();
  const [key, setKey] = useState(params.key || "");
  const [state, setState] = useState<any>(null);
  const [pick, setPick] = useState("4");
  const [msg, setMsg] = useState("");
  const [pickChip, setPickChip] = useState("");
  const [matches, setMatches] = useState<any[]>([]);

  useEffect(() => {
    api<{ matches: any[] }>("/api/home").then((d) => {
      setMatches(d.matches);
      if (!key) setKey(d.matches.find((m) => m.status === "live")?.key || d.matches[0]?.key || "");
    });
  }, []);

  async function load(matchKey: string) {
    if (!matchKey) return;
    setState(await api(`/api/predictions?matchKey=${matchKey}`));
  }
  useEffect(() => { load(key).catch((e) => setMsg(e.message)); }, [key]);

  return (
    <>
      <h2>{t(lang, "predict")}</h2>
      <p className="small">Points only. No cash, no odds. The server locks the pick before the ball.</p>
      <div className="chips">
        {matches.map((m) => <button key={m.key} className={`chip ${key === m.key ? "on" : ""}`} onClick={() => setKey(m.key)}>{m.teams.a.code} v {m.teams.b.code}</button>)}
      </div>
      <AdSlot slot="prediction_slot" matchKey={key} />
      <AdSlot slot="chip" matchKey={key} />
      <div className="chips">
        <span className="chip">Streak {state?.predStreak || 0}</span>
        <span className="chip">Saver {state?.savers || 0}</span>
        {(state?.chips || []).map((c: { kind: string; used: boolean }) => (
          <button key={c.kind} className={`chip ${pickChip === c.kind ? "on" : ""}`} disabled={c.used} onClick={() => setPickChip(pickChip === c.kind ? "" : c.kind)}>{c.kind}</button>
        ))}
        <button className={`chip ${pickChip === "doubledown" ? "on" : ""}`} disabled={!state?.doubleDown} onClick={() => setPickChip(pickChip === "doubledown" ? "" : "doubledown")}>double down</button>
      </div>
      <div className="card">
      <div className="small">Next ball</div>
      <div className="gridpick mt-3">
        {PICKS.map((p) => (
          <button key={p} className={`pick ${pick === p ? "on" : ""}`} onClick={() => { setPick(p); haptic("light"); window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); }}>{p === "dot" ? "·" : p === "wicket" ? "W" : p}</button>
        ))}
      </div>
      <button className="primary" disabled={!state?.open?.ball} onClick={async () => {
        try {
          await api("/api/predictions", { method: "POST", body: JSON.stringify({ matchKey: key, kind: "BALL", pick, ...(pickChip ? { chip: pickChip } : {}) }) });
          haptic("medium");
          setMsg("Locked.");
          load(key);
        } catch (e: any) { setMsg(e.message); }
      }}>{state?.open?.ball ? t(lang, "submit") : t(lang, "lock")}</button>
      </div>
      {state?.open?.match && (
        <div className="mt-3">
          <div className="small">Match result</div>
          <div className="flex gap-2">
            {["a", "b", "tie"].map((side) => <button key={side} className="ghost" onClick={async () => {
              await api("/api/predictions", { method: "POST", body: JSON.stringify({ matchKey: key, kind: "MATCH", pick: side }) });
              setMsg("Match pick locked.");
            }}>{side}</button>)}
          </div>
        </div>
      )}
      {state?.open?.over && (
        <form className="mt-2" onSubmit={async (e) => {
          e.preventDefault();
          const runs = new FormData(e.currentTarget).get("runs");
          await api("/api/predictions", { method: "POST", body: JSON.stringify({ matchKey: key, kind: "OVER", pick: String(runs) }) });
          setMsg("Over locked.");
        }}>
          <input className="field" name="runs" type="number" min={0} max={36} placeholder="Over runs" />
          <button className="primary">Lock over</button>
        </form>
      )}
      {msg && <p className="small mt-2">{msg}</p>}
      <h2>Your slips</h2>
      {(state?.mine || []).map((row: any) => (
        <div key={row.id} className="board"><span>{row.kind} {row.pick}</span><span>{row.settledAt ? (row.correct ? `+${row.points}` : "0") : "open"}</span><span className="small">{row.detail}</span></div>
      ))}
    </>
  );
}
