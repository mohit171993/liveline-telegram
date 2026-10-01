import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, haptic, t } from "../lib";

export function RewardsPage({ lang }: { lang: string }) {
  const [data, setData] = useState<any>(null);
  const [spin, setSpin] = useState(0);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  async function load() { setData(await api("/api/rewards")); }
  useEffect(() => { load().catch((e) => setNote(e.message)); }, []);
  const sponsor = data?.wheels?.[0]?.sponsorName;

  return (
    <>
      <h2>{t(lang, "rewards")}</h2>
      <Link className="ghost" to="/pass">{t(lang, "pass")}</Link>
      <p className="small">{data?.legal}</p>
      <div className="wheel" style={{ transform: `rotate(${spin}deg)` }} />
      <p className="text-center small">{sponsor ? `Spin by ${sponsor}` : t(lang, "spin")}</p>
      <button className="primary" onClick={async () => {
        try {
          const res = await api<any>("/api/rewards/spin", { method: "POST" });
          const slice = 360 / Math.max(1, res.segmentCount);
          setSpin((n) => n + 360 * 4 + res.index * slice);
          haptic("medium");
          setNote(`${res.prize.label} · ${res.source}`);
          setTimeout(load, 1200);
        } catch (e: any) { setNote(e.message); }
      }}>{data?.dailySpinAvailable ? t(lang, "spin") : `Bonus spins ${data?.bonusSpins || 0}`}</button>
      <h2>{t(lang, "scratch")}</h2>
      {(data?.scratches || []).map((card: any) => (
        <button key={card.id} className="listbtn" onClick={async () => {
          if (card.opened) return;
          const res = await api<any>(`/api/rewards/scratch/${card.id}`, { method: "POST" });
          setNote(res.result?.label || "Opened");
          load();
        }}>{card.opened ? card.result?.label : "Scratch"}</button>
      ))}
      <h2>{t(lang, "give")}</h2>
      {(data?.giveaways || []).map((g: any) => (
        <div key={g.id} className="card">
          <b>{g.title}</b>
          <p className="small">{g.description} · {g.prizeLabel}</p>
          <button className="ghost" disabled={g.entered} onClick={async () => { await api(`/api/rewards/giveaways/${g.id}/enter`, { method: "POST" }); load(); }}> {g.entered ? "Entered" : "Enter free"}</button>
        </div>
      ))}
      <h2>My rewards</h2>
      {(data?.vouchers || []).map((v: any) => (
        <div key={v.id} className="card">
          <b>{v.brandName}</b> · ₹{v.amountInr} · {v.status}
          {v.redeemCode && <div className="points mt-1">{v.redeemCode}</div>}
          {v.status === "awaiting_details" && (
            <form onSubmit={async (e) => { e.preventDefault(); await api(`/api/rewards/vouchers/${v.id}/claim`, { method: "POST", body: JSON.stringify({ email }) }); load(); }}>
              <input className="field" placeholder="Email for the voucher" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="primary">Claim</button>
            </form>
          )}
        </div>
      ))}
      {note && <p className="small">{note}</p>}
    </>
  );
}
