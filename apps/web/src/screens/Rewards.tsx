import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, haptic, t, toast } from "../lib";
import { Empty } from "../ui";

type Segment = { id: string; label: string; kind: string };
const FILL = ["#e7ff4d", "#1b2436", "#3dffe8", "#26324a", "#ff7a18", "#1b2436", "#3dffe8", "#26324a", "#e7ff4d", "#1b2436"];
const INK = (fill: string) => (fill === "#1b2436" || fill === "#26324a" ? "#f4f7fb" : "#0c1220");
const ICON: Record<string, string> = { points: "⭐", none: "🔁", boost: "🚀", theme: "🎨", badge: "🏅", voucher: "🎁", spin: "🎡" };
const FALLBACK: Segment[] = [
  { id: "a", label: "10 pts", kind: "points" }, { id: "b", label: "25 pts", kind: "points" },
  { id: "c", label: "50 pts", kind: "points" }, { id: "d", label: "Try again", kind: "none" },
  { id: "e", label: "Boost", kind: "boost" }, { id: "f", label: "Voucher", kind: "voucher" },
];

function Wheel({ segments, rotation }: { segments: Segment[]; rotation: number }) {
  const n = Math.max(1, segments.length);
  const slice = 360 / n;
  const r = 100;
  const point = (deg: number, radius = r) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [100 + radius * Math.cos(rad), 100 + radius * Math.sin(rad)];
  };
  return (
    <div className="wheel-wrap">
      <div className="wheel-pin" />
      <svg className="wheel-svg" viewBox="0 0 200 200" style={{ transform: `rotate(${rotation}deg)` }} role="img" aria-label="Free spin wheel">
        {segments.map((seg, i) => {
          const [x1, y1] = point(i * slice);
          const [x2, y2] = point((i + 1) * slice);
          const fill = FILL[i % FILL.length];
          const mid = (i + 0.5) * slice;
          const [tx, ty] = point(mid, 64);
          const label = seg.label.length > 12 ? `${seg.label.slice(0, 11)}…` : seg.label;
          return (
            <g key={seg.id}>
              <path d={`M100 100 L${x1} ${y1} A${r} ${r} 0 ${slice > 180 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={fill} stroke="#0c1220" strokeWidth="1.2" />
              <text x={tx} y={ty} fill={INK(fill)} fontSize={n > 8 ? 7.5 : 8.5} fontWeight={800} fontFamily="Inter, sans-serif" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid <= 180 ? mid - 90 : mid + 90} ${tx} ${ty})`}>
                {ICON[seg.kind] || "⭐"} {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="wheel-hub">🏏</div>
    </div>
  );
}

export function RewardsPage({ lang }: { lang: string }) {
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState("");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [email, setEmail] = useState("");
  const rot = useRef(0);
  async function load() {
    try { setData(await api("/api/rewards")); setFailed(""); } catch (e: any) { setFailed(e.message); }
  }
  useEffect(() => { load(); }, []);
  const wheel = data?.wheels?.[0];
  const segments: Segment[] = wheel?.segments?.length ? wheel.segments : FALLBACK;
  const turn = (to: number) => { rot.current = to; setRotation(to); };
  const canSpin = Boolean(data?.dailySpinAvailable || (data?.bonusSpins || 0) > 0);

  const lock = useRef(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const nextAt: number = data?.nextFreeSpinAt || nextIstMidnight();
  const wait = untilText(nextAt - now);

  function nudge(text: string) {
    // The button is never dead: say why there is no spin, and wiggle the wheel.
    haptic("light");
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("warning");
    setResult(text);
    toast(text, "err");
    turn(rot.current + 12);
    setTimeout(() => turn(rot.current - 12), 180);
  }

  async function spin() {
    if (lock.current) return;
    if (!data) { toast("Loading the wheel…"); load(); return; }
    if (!canSpin) {
      nudge(`⏳ Free spin used today. Next free spin in ${wait}.`);
      return;
    }
    lock.current = true;
    setSpinning(true);
    setResult("");
    haptic("light");
    turn(rot.current + 720); // React on tap; settle on the prize when the server answers.
    try {
      const res = await api<any>("/api/rewards/spin", { method: "POST" });
      const slice = 360 / Math.max(1, res.segmentCount || segments.length);
      const center = (res.index + 0.5) * slice;
      turn(Math.ceil(rot.current / 360) * 360 + 360 * 5 - center);
      setTimeout(() => {
        haptic("heavy");
        const label = res.prize?.label || "Try again";
        setResult(res.prize?.kind === "none" || !res.prize ? `🔁 ${label}. Come back tomorrow!` : `🎉 You won ${label}!`);
        toast(res.prize?.kind === "none" ? "No prize this time" : `You won ${label}`, "ok");
        lock.current = false;
        setSpinning(false);
        load();
      }, 4300);
    } catch (e: any) {
      const text = e.code === "NO_SPIN" ? `⏳ Free spin used today. Next free spin in ${wait}.` : e.message;
      turn(Math.ceil(rot.current / 360) * 360);
      setResult(text);
      toast(text, "err");
      lock.current = false;
      setSpinning(false);
      load();
    }
  }


  const scratches: any[] = data?.scratches || [];
  const giveaways: any[] = data?.giveaways || [];
  const vouchers: any[] = data?.vouchers || [];

  return (
    <>
      <div className="page-head">
        <h2>{t(lang, "rewards")}</h2>
        <button className="chip" onClick={() => nav("/pass")}>🎟️ {t(lang, "pass")}</button>
      </div>
      <p className="small">{data?.legal || "Free only. No purchase, no cash, no withdrawal."}</p>
      {failed && <Empty icon="📡" title="Rewards didn't load" text={failed} cta="Retry" onCta={load} />}
      <Wheel segments={segments} rotation={rotation} />
      <p className="text-center small">{wheel?.sponsorName ? `Spin by ${wheel.sponsorName}` : "One free spin every day · points and sponsor vouchers"}</p>
      <button type="button" className={`primary spin-btn ${data && !canSpin ? "used" : ""}`} aria-busy={spinning} onClick={spin}>
        {spinning ? "Spinning…" : !data ? "🎡 Spin free" : data.dailySpinAvailable ? "🎡 Spin free" : data.bonusSpins > 0 ? `🎡 Bonus spin (${data.bonusSpins} left)` : `⏳ Next free spin in ${wait}`}
      </button>
      {!result && data && !data.dailySpinAvailable && data.todaySpin?.label && <p className="text-center small">Today's spin: {data.todaySpin.label}</p>}
      {result && <div className="result-card">{result}</div>}

      <h2>{t(lang, "scratch")}</h2>
      {scratches.length === 0 ? (
        <Empty icon="🎟️" title="No scratch cards yet" text="Win them from prediction streaks and missions." cta="Make a prediction" onCta={() => nav("/predict")} />
      ) : scratches.map((card) => (
        <button key={card.id} className="listbtn" disabled={card.opened} onClick={async () => {
          const res = await api<any>(`/api/rewards/scratch/${card.id}`, { method: "POST" });
          toast(res.result?.label ? `Scratched: ${res.result.label}` : "Opened");
          load();
        }}>{card.opened ? `✅ ${card.result?.label || "Opened"}` : "✨ Scratch"}</button>
      ))}

      <h2>{t(lang, "give")}</h2>
      {giveaways.length === 0 ? (
        <Empty icon="🎁" title="No free draws right now" text="Sponsor draws appear here. Entry is always free." />
      ) : giveaways.map((g) => (
        <div key={g.id} className="card">
          <b>{g.title}</b>
          <p className="small">{g.description} · {g.prizeLabel}</p>
          <button className="ghost" disabled={g.entered} onClick={async () => { await api(`/api/rewards/giveaways/${g.id}/enter`, { method: "POST" }); toast("You're in the draw"); load(); }}>{g.entered ? "Entered ✅" : "Enter free"}</button>
        </div>
      ))}

      <h2>My rewards</h2>
      {vouchers.length === 0 ? (
        <Empty icon="🏆" title="Nothing won yet" text="Spin daily for points and sponsor vouchers." />
      ) : vouchers.map((v) => (
        <div key={v.id} className="card">
          <b>{v.brandName}</b> · ₹{v.amountInr} · {v.status}
          {v.redeemCode && <div className="points mt-1">{v.redeemCode}</div>}
          {v.status === "awaiting_details" && (
            <form onSubmit={async (e) => { e.preventDefault(); await api(`/api/rewards/vouchers/${v.id}/claim`, { method: "POST", body: JSON.stringify({ email }) }); toast("Claim sent"); load(); }}>
              <input className="field" type="email" required placeholder="Email for the voucher" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="primary">Claim</button>
            </form>
          )}
        </div>
      ))}
    </>
  );
}

function nextIstMidnight(): number {
  // IST is UTC+5:30 with no DST: the free spin resets at 18:30 UTC.
  const now = Date.now();
  const ist = now + 5.5 * 3600_000;
  return ist - (ist % 86_400_000) + 86_400_000 - 5.5 * 3600_000;
}

function untilText(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
