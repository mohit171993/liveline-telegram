import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, initData, t, wsBase, type Match } from "../lib";
import { pillClass } from "./Home";
import { AdSlot } from "./Ad";
import { Celebrate, muted, setMuted } from "./Celebrate";
import { Avatar, STATUS_STICKER } from "../Avatar";

export function MatchPage({ lang }: { lang: string }) {
  const { key = "" } = useParams();
  const nav = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [tab, setTab] = useState("line");
  const [moments, setMoments] = useState<string[]>([]);
  const [mute, setMute] = useState(muted());
  const [cheers, setCheers] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [laneOn, setLaneOn] = useState(localStorage.getItem("ll-lane") !== "off");
  const [lane, setLane] = useState<{ id: string; body: string }[]>([]);

  async function load() {
    setMatch(await api<Match>(`/api/matches/${key}`));
  }
  useEffect(() => { load().catch(() => undefined); const id = setInterval(load, 4000); return () => clearInterval(id); }, [key]);
  useEffect(() => {
    if (!moments[0]) return;
    const id = setTimeout(() => setMoments((cur) => cur.slice(1)), 2600);
    return () => clearTimeout(id);
  }, [moments[0]]);

  useEffect(() => {
    const back = () => nav(-1);
    window.Telegram?.WebApp?.BackButton.show();
    window.Telegram?.WebApp?.BackButton.onClick(back);
    window.Telegram?.WebApp?.MainButton.setText(t(lang, "predict"));
    window.Telegram?.WebApp?.MainButton.show();
    const go = () => nav(`/predict/${key}`);
    window.Telegram?.WebApp?.MainButton.onClick(go);
    return () => {
      window.Telegram?.WebApp?.BackButton.hide();
      window.Telegram?.WebApp?.BackButton.offClick(back);
      window.Telegram?.WebApp?.MainButton.hide();
      window.Telegram?.WebApp?.MainButton.offClick(go);
    };
  }, [key, lang, nav]);

  useEffect(() => {
    const ws = new WebSocket(`${wsBase()}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", initData: initData() }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "ready") ws.send(JSON.stringify({ type: "join", matchKey: key }));
      const list = Array.isArray(msg.moments) && msg.moments.length ? msg.moments : msg.moment ? [msg.moment] : [];
      if (list.length && (msg.key === key || !msg.key)) {
        setMoments((cur) => [...cur, ...list].slice(-6));
        load();
      }
      if (msg.type === "cheer" && msg.key === key) {
        setCheers((cur) => [...cur, { id: msg.id || String(Date.now()), emoji: msg.emoji, x: 16 + Math.random() * 70 }].slice(-12));
      }
      if (msg.type === "danmaku" && msg.key === key) {
        setLane((cur) => [...cur, { id: msg.id || String(Date.now()), body: msg.body }].slice(-8));
      }
    };
    return () => ws.close();
  }, [key]);

  if (!match) return <div className="skel" />;
  const live = match.live;
  const bat = live ? match.teams[live.batting] : match.teams.a;

  return (
    <>
      {moments[0] && (
        <Celebrate moment={moments[0]} lang={lang} matchKey={match.key} onDone={() => setMoments((cur) => cur.slice(1))} />
      )}
      {cheers.map((c) => <span key={c.id} className="float" style={{ left: `${c.x}%` }} aria-hidden="true">{c.emoji}</span>)}
      <div className="hero">
        <div className="row">
          <span className="livepill">{match.status === "live" && <i className="dot" />} {STATUS_STICKER[match.status] || ""} {match.status === "live" ? t(lang, "live") : match.status}</span>
          <button className="iconbtn" aria-pressed={mute} onClick={() => { const next = !mute; setMute(next); setMuted(next); }}>{mute ? t(lang, "unmute") : t(lang, "mute")}</button>
          <span className="demo">{match.demo ? t(lang, "demo") : match.format}</span>
        </div>
        <div className="small mt-2">{match.teams.a.flag} {match.teams.a.name} vs {match.teams.b.flag} {match.teams.b.name}</div>
        <div className="score" style={{ color: bat.color }}>{live ? `${live.runs}/${live.wickets}` : match.result || "—"}</div>
        <div className="need">{lang === "hi" ? live?.needHi : live?.need || match.toss}</div>
        {live && <div className="meta">{live.overs} · {t(lang, "crr")} {live.crr} · {t(lang, "rrr")} {live.rrr ?? "—"} · {t(lang, "proj")} {live.projected ?? "—"}</div>}
        {live && <div className="win"><i style={{ width: `${live.win.a}%`, background: match.teams.a.color }} /><i style={{ width: `${live.win.b}%`, background: match.teams.b.color }} /></div>}
        <div className="small">{live?.mood ? `${live.mood.emoji} ${lang === "hi" ? live.mood.labelHi : live.mood.label} · ` : ""}{t(lang, "win")} {live ? `${match.teams.a.code} ${live.win.a} · ${match.teams.b.code} ${live.win.b}` : ""}</div>
        {live?.luck && (
          <div className="small mt-2">{live.luck.emoji} Luck {live.luck.score} · {lang === "hi" ? live.luck.labelHi : live.luck.label}
            {live.forecast ? ` · next over ${live.forecast.low}–${live.forecast.high} · wicket ${live.forecast.wicketChance}%` : ""}
          </div>
        )}
        {laneOn && <div className="lane" aria-label="Comments">{lane.map((n) => <span key={n.id} className="fly">{n.body}</span>)}</div>}
      </div>
      <AdSlot slot="luck" matchKey={match.key} />
      <div className="row">
        <button className="ghost" onClick={() => { const next = !laneOn; setLaneOn(next); localStorage.setItem("ll-lane", next ? "on" : "off"); }}>{laneOn ? "Hide comments" : "Show comments"}</button>
      </div>
      <AdSlot slot="danmaku" matchKey={match.key} />
      <form onSubmit={async (e) => {
        e.preventDefault();
        const body = String(new FormData(e.currentTarget).get("body") || "");
        e.currentTarget.reset();
        const note = await api<{ id: string; body: string }>(`/api/matches/${match.key}/danmaku`, { method: "POST", body: JSON.stringify({ body }) });
        setLane((cur) => [...cur, note].slice(-8));
      }}>
        <input className="field" name="body" maxLength={42} placeholder="Short comment" aria-label="Comment" />
      </form>
      <AdSlot slot="powered_by" matchKey={match.key} />
      <FanMeter matchKey={match.key} lang={lang} />
      <MiniPlay matchKey={match.key} lang={lang} />
      <div className="tabs">
        {["line", "card", "charts", "chat", "ai"].map((id) => (
          <button key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => { if (id === "ai") nav(`/ai/${match.key}`); else setTab(id); }}>{t(lang, id as "line")}</button>
        ))}
      </div>
      {tab === "line" && live && (
        <>
          <Vote matchKey={match.key} open={!!match.voteOpen} />
          {(match.moments || []).length > 0 && (
            <>
              <h2>Key moments</h2>
              {match.moments!.slice(0, 4).map((m, i) => <div key={i} className="small">{m.over} {m.kind} {m.text}</div>)}
            </>
          )}
          <div className="kpis">
            <div className="kpi"><span className="small">{t(lang, "partner")}</span><b>{live.partnership.runs}</b><span className="small">{live.partnership.balls} balls</span></div>
            <div className="kpi"><span className="small">{t(lang, "crr")}</span><b>{live.crr}</b></div>
            <div className="kpi"><span className="small">{t(lang, "rrr")}</span><b>{live.rrr ?? "—"}</b></div>
          </div>
          <div className="small">{t(lang, "thisOver")}</div>
          <div className="pills">{live.thisOver.map((b, i) => <span key={i} className={pillClass(b)}>{b}</span>)}</div>
          {live.striker?.look && <div className="who"><Avatar look={live.striker.look} size={44} /><b>{live.striker.name} *</b><span>{live.striker.runs} ({live.striker.balls})</span></div>}
          {live.nonStriker?.look && <div className="who"><Avatar look={live.nonStriker.look} size={44} /><b>{live.nonStriker.name}</b><span>{live.nonStriker.runs} ({live.nonStriker.balls})</span></div>}
          {live.bowler?.look && <div className="who"><Avatar look={live.bowler.look} size={44} /><b>{live.bowler.name}</b><span>{live.bowler.overs} · {live.bowler.wickets}-{live.bowler.runs}</span></div>}
          <h2>Commentary</h2>
          {(match.commentary || []).slice(0, 8).map((line, i) => (
            <div key={i} className="py-2 border-b border-white/5"><span className="small">{line.over}</span> {lang === "hi" ? line.textHi : line.text}</div>
          ))}
          <h2>Venue</h2>
          <p className="small">{match.venue}, {match.city}. {match.pitch}</p>
          <h2>Head to head</h2>
          <p className="small">{match.h2h?.played} played · {match.teams.a.code} {match.h2h?.aWins} · {match.teams.b.code} {match.h2h?.bWins}. {match.h2h?.last}</p>
          <h2>Points</h2>
          {(match.points || []).map((row) => <div key={row.team} className="board"><b>{row.team}</b><span>{row.pts}</span><span>{row.nrr}</span></div>)}
          <h2>Playing XI</h2>
          <AdSlot slot="fan_xi" matchKey={match.key} />
          <button className="ghost" onClick={async () => {
            const ids = [...(match.xi?.a || []), ...(match.xi?.b || [])].slice(0, 11).map((p) => p.id);
            if (ids.length === 11) await api(`/api/matches/${match.key}/xi`, { method: "POST", body: JSON.stringify({ playerIds: ids }) });
          }}>Save fan XI</button>
          <div className="chips">
            {match.xi?.a.map((p) => <span key={p.id} className="chip">{p.look ? <Avatar look={p.look} size={28} /> : p.role} {p.name.split(" ").slice(-1)}</span>)}
          </div>
          <div className="chips">
            {match.xi?.b.map((p) => <span key={p.id} className="chip">{p.look ? <Avatar look={p.look} size={28} /> : p.role} {p.name.split(" ").slice(-1)}</span>)}
          </div>
        </>
      )}
      {tab === "card" && (match.innings || []).map((inn) => (
        <div key={inn.title + inn.overs} className="mt-3">
          <h2>{inn.title} {inn.runs}/{inn.wickets} ({inn.overs})</h2>
          {inn.batters.map((b) => <div key={b.id} className="who">{b.look && <Avatar look={b.look} size={36} />}<b>{b.name}{b.out ? "" : " *"} <i className="small">{b.dismissal || "not out"}</i></b><span>{b.runs}</span></div>)}
          {inn.bowlers.map((b) => <div key={b.id} className="board"><span>{b.name}</span><span>{b.overs}</span><span>{b.wickets}/{b.runs}</span></div>)}
        </div>
      ))}
      {tab === "charts" && <Charts match={match} />}
      {tab === "chat" && <Chat matchKey={match.key} />}
    </>
  );
}

function Charts({ match }: { match: Match }) {
  const mans = (match.manhattan || []).filter((m) => m.innings === (match.live ? 2 : 1));
  const max = Math.max(1, ...mans.map((m) => m.runs));
  const worm = match.worm || [];
  const maxW = Math.max(1, ...worm.map((w) => w.runs));
  return (
    <>
      <h2>Manhattan</h2>
      <svg className="chart" viewBox="0 0 300 120">
        {mans.map((m, i) => <rect key={i} x={i * 14} y={110 - (m.runs / max) * 100} width="10" height={(m.runs / max) * 100} fill={m.wickets ? "#ff5d7a" : "#e7ff4d"} />)}
      </svg>
      <h2>Worm</h2>
      <svg className="chart" viewBox="0 0 300 120">
        <polyline fill="none" stroke="#8ee7ff" strokeWidth="2" points={worm.filter((w) => w.innings === 1).map((w, i) => `${i * 14},${110 - (w.runs / maxW) * 100}`).join(" ")} />
        <polyline fill="none" stroke="#e7ff4d" strokeWidth="2" points={worm.filter((w) => w.innings === 2).map((w, i) => `${i * 14},${110 - (w.runs / maxW) * 100}`).join(" ")} />
      </svg>
      <h2>Wagon</h2>
      <svg className="chart" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.2)" />
        {(match.wagon || []).map((w, i) => <circle key={i} cx={w.x} cy={w.y} r={w.runs >= 6 ? 2.4 : 1.6} fill={w.wicket ? "#ff5d7a" : w.runs >= 4 ? "#e7ff4d" : "#8ee7ff"} />)}
      </svg>
    </>
  );
}

const CHEERS = ["🔥", "👏", "😱", "💚", "🎺"];

function FanMeter({ matchKey, lang }: { matchKey: string; lang: string }) {
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState("");
  async function load() { setData(await api(`/api/matches/${matchKey}/fans`)); }
  useEffect(() => { load().catch(() => undefined); const id = setInterval(load, 4000); return () => clearInterval(id); }, [matchKey]);
  if (!data) return null;
  const total = Math.max(1, data.a + data.b);
  async function pick(teamKey: string) {
    await api("/api/fan", { method: "POST", body: JSON.stringify({ teamKey }) });
    load();
  }
  async function cheer(emoji: string) {
    try {
      await api(`/api/matches/${matchKey}/cheer`, { method: "POST", body: JSON.stringify({ emoji }) });
      load();
    } catch (err: any) { setNote(err.message); }
  }
  return (
    <section className="card" aria-label={t(lang, "fans")}>
      <div className="row"><b>{t(lang, "fans")}</b><span className="small">{data.you ? "Your side" : "Pick a side"}</span></div>
      <div className="win" aria-hidden="true">
        <i style={{ width: `${(data.a / total) * 100}%`, background: data.teams.a.color }} />
        <i style={{ width: `${(data.b / total) * 100}%`, background: data.teams.b.color }} />
      </div>
      <div className="row small"><span>{data.teams.a.flag} {data.a}</span><span>{data.b} {data.teams.b.flag}</span></div>
      <div className="chips">
        {[data.teams.a, data.teams.b].map((team: any) => (
          <button key={team.key} className={`chip ${(data.you === "a" && team.key === data.teams.a.key) || (data.you === "b" && team.key === data.teams.b.key) ? "on" : ""}`} style={{ borderColor: team.color }} onClick={() => pick(team.key)}>{team.flag} {team.code}</button>
        ))}
      </div>
      <div className="pills" aria-label={t(lang, "cheer")}>
        {CHEERS.map((emoji) => <button key={emoji} className="pill" onClick={() => cheer(emoji)} aria-label={`${t(lang, "cheer")} ${emoji}`}>{emoji}</button>)}
      </div>
      {note && <p className="small">{note}</p>}
      <AdSlot slot="fan_meter" matchKey={matchKey} />
      <AdSlot slot="cheer" matchKey={matchKey} />
    </section>
  );
}

function MiniPlay({ matchKey, lang }: { matchKey: string; lang: string }) {
  const [data, setData] = useState<any>(null);
  const [guess, setGuess] = useState("90");
  const [note, setNote] = useState("");
  async function load() { setData(await api(`/api/matches/${matchKey}/play`)); }
  useEffect(() => { load().catch(() => undefined); const id = setInterval(load, 5000); return () => clearInterval(id); }, [matchKey]);
  if (!data || (!data.trivia && !data.overs10)) return null;
  return (
    <section className="card">
      <h2>Break games</h2>
      <p className="small">Free. Points only. No cash.</p>
      <AdSlot slot="minigame" matchKey={matchKey} />
      {data.trivia && (
        <div>
          <p>{lang === "hi" ? data.trivia.promptHi : data.trivia.prompt}</p>
          {data.trivia.mine ? <p className="small">Locked · {data.trivia.mine.points} pts</p> : (
            <div className="chips">
              {data.trivia.options.map((opt: string) => (
                <button key={opt} className="chip" onClick={async () => {
                  const res = await api<any>(`/api/matches/${matchKey}/play`, { method: "POST", body: JSON.stringify({ kind: "trivia", pick: opt }) });
                  setNote(res.correct ? `Correct · ${res.points} pts` : `Answer: ${res.answer}`);
                  load();
                }}>{opt}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {data.overs10 && (
        <div>
          <p className="small">{data.overs10.open ? "Guess the score at 10 overs" : `10-over score ${data.overs10.actual ?? "—"}`}</p>
          {data.overs10.open && !data.overs10.mine && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              await api(`/api/matches/${matchKey}/play`, { method: "POST", body: JSON.stringify({ kind: "overs10", pick: guess }) });
              setNote("Guess locked");
              load();
            }}>
              <label className="small" htmlFor="overs10">Score after 10 overs</label>
              <input id="overs10" className="field" inputMode="numeric" value={guess} onChange={(e) => setGuess(e.target.value)} />
              <button className="primary">Lock guess</button>
            </form>
          )}
          {data.overs10.mine && <p className="small">Your guess {data.overs10.mine.pick}{data.overs10.mine.settledAt ? ` · ${data.overs10.mine.points} pts` : ""}</p>}
        </div>
      )}
      {note && <p className="small">{note}</p>}
    </section>
  );
}

function Vote({ matchKey, open }: { matchKey: string; open: boolean }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { if (open) api(`/api/matches/${matchKey}/vote`).then(setData).catch(() => undefined); }, [matchKey, open]);
  if (!open || !data) return null;
  return (
    <section className="card">
      <h2>Fan vote</h2>
      <AdSlot slot="fan_vote" matchKey={matchKey} />
      <p className="small">Opens late. The result is fans versus the stats card. Points only.</p>
      {data.categories.map((c: any) => (
        <div key={c.id}>
          <div className="small">{c.emoji} {c.label}{c.fan ? ` · fans ${c.fan} · stats ${c.stats}` : ""}</div>
          {!c.yours && (
            <div className="chips">
              {data.players.slice(0, 6).map((p: { id: string; name: string }) => (
                <button key={p.id} className="chip" onClick={async () => setData(await api(`/api/matches/${matchKey}/vote`, { method: "POST", body: JSON.stringify({ category: c.id, playerId: p.id }) }))}>{p.name.split(" ").slice(-1)}</button>
              ))}
            </div>
          )}
          {c.yours && <p className="small">Locked</p>}
        </div>
      ))}
    </section>
  );
}

function Chat({ matchKey }: { matchKey: string }) {
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  async function load() { setData(await api(`/api/chat/${matchKey}`)); }
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, [matchKey]);
  async function sendReaction(emoji: string) {
    await api(`/api/chat/${matchKey}/react`, { method: "POST", body: JSON.stringify({ emoji }) });
    await load();
  }
  return (
    <div>
      <div className="pills">
        {Object.entries(data?.reactions || {}).map(([emoji, n]) => (
          <button key={emoji} className="pill" onClick={() => sendReaction(emoji)}>{emoji} {String(n)}</button>
        ))}
        {["🔥", "👏", "😱"].map((emoji) => (
          <button key={emoji} className="pill" onClick={() => sendReaction(emoji)}>{emoji}</button>
        ))}
      </div>
      <div className="chat mt-3">
        {(data?.messages || []).map((m: any) => (
          <div key={m.id} className="who">{m.look && <Avatar look={m.look} size={32} />}<div><b className="small">{m.name}</b><div>{m.body}</div></div></div>
        ))}
      </div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await api(`/api/chat/${matchKey}`, { method: "POST", body: JSON.stringify({ body: text }) });
        setText("");
        load();
      }}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Watch party" />
      </form>
    </div>
  );
}
