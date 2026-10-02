import { useEffect, useState } from "react";
import { api, toast } from "../lib";
import { AdSlot } from "./Ad";

type Play = {
  friendCode: string;
  friendStreak: number;
  chips: { predStreak: number; savers: number; doubleDown: number; chips: { kind: string; used: boolean }[]; note: string };
  puzzle: { grid: string; puzzles: { key: string; prompt: string; options: { id: string; label: string }[]; points: number }[]; attempts: { key: string; correct: boolean; points: number }[] };
  album: { packsLeft: number; note: string; sets: { set: string; have: number; total: number }[]; stickers: { id: string; emoji: string; face: string; name: string; count: number; set: string }[] };
  tickets: { matchKey: string; teamKey: string; badge: string; stub: boolean; name: string; window: string }[];
  squads: { yours: { title: string | null; points: number; code: string | null }[]; rows: { rank: number; title: string; points: number; you: boolean }[] };
  league: { name: string; tier: number; points: number; rank: number; outcome: string; next: string; rows: { rank: number; name: string; points: number; you: boolean }[] };
};

export function PlayPage({ lang }: { lang: string }) {
  const [data, setData] = useState<Play | null>(null);
  const [msg, setMsg] = useState("");
  const [rank, setRank] = useState<string[]>([]);

  const [next, setNext] = useState<{ key: string; teamKey: string; teamName: string } | null>(null);
  async function load() {
    setData(await api<Play>("/api/play"));
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    api<{ matches: any[] }>("/api/home").then(({ matches }) => {
      const m = matches.filter((x) => x.status === "upcoming").sort((a, b) => a.startAt - b.startAt)[0] || matches.find((x) => x.status === "live");
      if (m) setNext({ key: m.key, teamKey: m.teams.a.key, teamName: m.teams.a.name });
    }).catch(() => undefined);
  }, []);

  if (!data && msg) return <div className="empty"><div className="empty-icon">📡</div><b>Play didn't load</b><p className="small">{msg}</p><button className="primary" onClick={() => { setMsg(""); load().catch((e) => setMsg(e.message)); }}>Retry</button></div>;
  if (!data) return <><div className="skel" /><div className="skel" /></>;
  const hi = lang === "hi";

  return (
    <>
      <h2>{hi ? "खेल" : "Play"}</h2>
      <p className="small">{data.chips.note}</p>
      <AdSlot slot="chip" />
      <div className="kpis">
        <div className="kpi"><span className="small">Streak</span><b>{data.chips.predStreak}</b></div>
        <div className="kpi"><span className="small">Saver</span><b>{data.chips.savers}</b></div>
        <div className="kpi"><span className="small">Double</span><b>{data.chips.doubleDown}</b></div>
      </div>
      <AdSlot slot="pred_streak" />
      <div className="chips">
        {data.chips.chips.map((c) => <span key={c.kind} className={`chip ${c.used ? "" : "on"}`}>{chipFace(c.kind)} {c.kind} {c.used ? "used" : "ready"}</span>)}
      </div>

      <h2>{hi ? "पहेली" : "Daily puzzle"}</h2>
      <AdSlot slot="puzzle" />
      <p className="grid5" aria-label="Result grid">{data.puzzle.grid}</p>
      {data.puzzle.puzzles.map((p) => {
        const done = data.puzzle.attempts.find((a) => a.key === p.key);
        return (
          <div key={p.key} className="card">
            <b>{p.prompt}</b>
            <span className="small"> {p.points} pts · rarer answers pay more</span>
            {done ? <p className="small">{done.correct ? `+${done.points}` : "Miss"}</p> : (
              <div className="chips">
                {p.key === "rank" ? (
                  <>
                    {p.options.map((o) => <button key={o.id} className={`chip ${rank.includes(o.id) ? "on" : ""}`} onClick={() => setRank((cur) => cur.includes(o.id) ? cur : [...cur, o.id].slice(0, 5))}>{o.label.split(" ").slice(-1)}</button>)}
                    <button className="ghost" onClick={async () => { const r = await api<any>("/api/puzzle", { method: "POST", body: JSON.stringify({ key: "rank", answer: rank.join(",") }) }); setRank([]); { const a = r?.attempts?.find((x: any) => x.key === "rank"); toast(a?.correct ? `✅ Correct! +${a.points}` : "❌ Not this time"); } load(); }}>Lock order</button>
                  </>
                ) : p.options.map((o) => (
                  <button key={o.id} className="chip" onClick={async () => { const r = await api<any>("/api/puzzle", { method: "POST", body: JSON.stringify({ key: p.key, answer: o.id }) }); { const a = r?.attempts?.find((x: any) => x.key === p.key); toast(a?.correct ? `✅ Correct! +${a.points}` : "❌ Not this time"); } load(); }}>{o.label}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <h2>{hi ? "स्टिकर" : "Sticker album"}</h2>
      <AdSlot slot="album" />
      <p className="small">{data.album.note} · {data.album.packsLeft} left today</p>
      <button className="primary" disabled={data.album.packsLeft < 1} onClick={async () => { const r = await api<any>("/api/album/pack", { method: "POST" }); const got = ((r?.pull || []) as any[]).filter(Boolean); toast(got.length ? `📦 ${got.map((x) => `${x.face || ""}${x.emoji || ""}`).join(" ")}` : "📦 Pack opened"); load(); }}>Open a free pack</button>
      {data.album.sets.map((s) => <div key={s.set} className="board"><span>{s.set}</span><span>{s.have}/{s.total}</span></div>)}
      <div className="chips">
        {data.album.stickers.filter((s) => s.count > 0).map((s) => <span key={s.id} className="chip">{s.face}{s.emoji} {s.count}</span>)}
      </div>

      <h2>{hi ? "टिकट" : "Match ticket"}</h2>
      <AdSlot slot="ticket" />
      <p className="small">Claim one 30 minutes before the start. It gives a team skin, a chat badge, and a stub to keep. Not for sale.</p>
      {next ? (
        <button className="ghost w-full" onClick={async () => {
          try {
            await api("/api/tickets", { method: "POST", body: JSON.stringify({ matchKey: next.key, teamKey: next.teamKey }) });
            toast("🎫 Ticket claimed");
            load();
          } catch (err) { toast(err instanceof Error ? err.message : "Gate closed", "err"); }
        }}>🎫 Claim {next.teamName} ticket</button>
      ) : <p className="small">No upcoming match to claim a ticket for yet.</p>}
      {data.tickets.map((t) => <div key={t.matchKey} className="board"><span>{t.badge} {t.name}</span><span>{t.stub ? "Stub" : t.window}</span></div>)}

      <h2>{hi ? "स्क्वाड" : "Squads"}</h2>
      <AdSlot slot="squad" />
      <p className="small">Add the bot to a group or channel and send /squad. Member points add up. Referral link starts with sq_.</p>
      {data.squads.rows.map((r) => <div key={r.rank} className={`board ${r.you ? "rank you" : ""}`}><span>{r.rank}. {r.title}</span><b>{r.points}</b></div>)}
      <button className="ghost w-full" onClick={async () => { await api("/api/squads", { method: "POST", body: JSON.stringify({ title: "Night Watch" }) }); toast("👥 Squad created"); load(); }}>Make Night Watch</button>

      <h2>{data.league.name} league</h2>
      <AdSlot slot="league" />
      <p className="small">Tier {data.league.tier}/10 · rank {data.league.rank} · {data.league.outcome} toward {data.league.next}. Weekly, points only.</p>
      {data.league.rows.map((r) => <div key={r.rank} className="board"><span>{r.rank}. {r.name}</span><span>{r.points}</span></div>)}

      <h2>Friends</h2>
      <p className="small">Your code {data.friendCode}. Friend streak {data.friendStreak}. Codes are not a purchase.</p>
      <button className="primary" onClick={async () => {
        const me = await api<{ user: { referralLink: string } }>("/api/me");
        const link = me.user.referralLink;
        const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Live cricket line, match alerts and free predictions on LiveLine Pro 🏏")}`;
        if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(share); else window.open(share, "_blank", "noopener");
      }}>👥 Invite friends</button>
      {msg && <p className="small">{msg}</p>}
    </>
  );
}

function chipFace(kind: string) {
  if (kind === "triple") return "3️⃣";
  if (kind === "freehit") return "🆓";
  if (kind === "boost") return "🚀";
  return "🎲";
}
