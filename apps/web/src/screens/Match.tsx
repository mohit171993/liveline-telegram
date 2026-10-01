import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, initData, t, toast, wsBase, type Match } from "../lib";
import { Empty, kickoff, pillClass, placeOf } from "../ui";
import { Flag } from "../flags";
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

  const [failed, setFailed] = useState("");
  async function load() {
    try { setMatch(await api<Match>(`/api/matches/${key}`)); setFailed(""); } catch (e: any) { setFailed(e.message || "error"); }
  }
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, [key]);
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
        const id = String(msg.id || `${Date.now()}-${Math.random()}`);
        setCheers((cur) => cur.some((c) => c.id === id) ? cur : [...cur, { id, emoji: msg.emoji, x: 16 + Math.random() * 70 }].slice(-12));
      }
      if (msg.type === "danmaku" && msg.key === key) {
        const id = String(msg.id || `${Date.now()}-${Math.random()}`);
        setLane((cur) => cur.some((c) => c.id === id) ? cur : [...cur, { id, body: msg.body }].slice(-8));
      }
    };
    return () => ws.close();
  }, [key]);

  if (!match && failed) return <Empty icon="🏏" title="This match isn't available" text={failed} cta="See all matches" onCta={() => nav("/")} />;
  if (!match) return <><div className="skel hero-skel" /><div className="skel" /></>;
  const live = match.live;
  const bat = live ? match.teams[live.batting] : match.teams.a;
  const winText = live?.win ? `${match.teams.a.code} ${live.win.a}% · ${match.teams.b.code} ${live.win.b}%` : "";
  const start = kickoff(match.startAt);
  const place = placeOf(match);
  const detail = [start.clock, place].filter(Boolean).join(" · ");
  const commentary = (match.commentary || []).filter((line) => (lang === "hi" ? line.textHi : line.text));
  const points = match.points || [];
  const xiCount = (match.xi?.a.length || 0) + (match.xi?.b.length || 0);

  return (
    <>
      {moments[0] && (
        <Celebrate moment={moments[0]} lang={lang} matchKey={match.key} onDone={() => setMoments((cur) => cur.slice(1))} />
      )}
      {cheers.map((c) => <span key={c.id} className="float" style={{ left: `${c.x}%` }} aria-hidden="true">{c.emoji}</span>)}
      <div className="hero">
        <div className="row">
          <span className="livepill">{match.status === "live" && <i className="dot" />} {STATUS_STICKER[match.status] || ""} {match.status === "live" ? t(lang, "live") : match.status}</span>
          <span className="demo">{match.demo ? t(lang, "demo") : match.format}</span>
        </div>
        <div className="versus compact">
          <div className="side"><Flag code={match.teams.a.code} size={36} /><strong>{match.teams.a.code}</strong></div>
          <div className="side"><Flag code={match.teams.b.code} size={36} /><strong>{match.teams.b.code}</strong></div>
        </div>
        {live ? (
          <div className="score" style={{ color: bat.color }}>{live.runs}/{live.wickets}</div>
        ) : match.status === "completed" ? (
          <div className="hero-state"><b>{match.result || "Result"}</b></div>
        ) : (
          <div className="hero-state">
            <b>{start.headline}</b>
            {detail && <span>{detail}</span>}
          </div>
        )}
        {live && <div className="need">{lang === "hi" ? live.needHi : live.need || match.toss}</div>}
        {live && <div className="meta">{live.overs} · {t(lang, "crr")} {live.crr} · {t(lang, "rrr")} {live.rrr ?? "—"} · {t(lang, "proj")} {live.projected ?? "—"}</div>}
        {winText && (
          <>
            <div className="win"><i style={{ width: `${live!.win.a}%`, background: match.teams.a.color }} /><i style={{ width: `${live!.win.b}%`, background: match.teams.b.color }} /></div>
            <div className="small">{live?.mood ? `${live.mood.emoji} ${lang === "hi" ? live.mood.labelHi : live.mood.label} · ` : ""}{t(lang, "win")} {winText}</div>
          </>
        )}
        {live?.luck && (
          <div className="small mt-2">{live.luck.emoji} Luck {live.luck.score} · {lang === "hi" ? live.luck.labelHi : live.luck.label}
            {live.forecast ? ` · next over ${live.forecast.low}–${live.forecast.high} · wicket ${live.forecast.wicketChance}%` : ""}
          </div>
        )}
        {laneOn && <div className="lane" aria-label="Comments">{lane.map((n) => <span key={n.id} className="fly">{n.body}</span>)}</div>}
        <div className="match-tools" role="toolbar" aria-label="Match tools">
          <button type="button" aria-pressed={mute} className={mute ? "on" : ""} onClick={() => { const next = !mute; setMute(next); setMuted(next); }}>{mute ? t(lang, "unmute") : t(lang, "mute")}</button>
          <button type="button" aria-pressed={!laneOn} className={laneOn ? "" : "on"} onClick={() => { const next = !laneOn; setLaneOn(next); localStorage.setItem("ll-lane", next ? "on" : "off"); }}>{laneOn ? "Hide comments" : "Show comments"}</button>
        </div>
      </div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const body = String(new FormData(e.currentTarget).get("body") || "");
        e.currentTarget.reset();
        const note = await api<{ id: string; body: string }>(`/api/matches/${match.key}/danmaku`, { method: "POST", body: JSON.stringify({ body }) });
        setLane((cur) => cur.some((c) => c.id === note.id) ? cur : [...cur, note].slice(-8));
        toast("💬 Comment sent");
      }} className="flex gap-2">
        <input className="field" name="body" maxLength={42} required placeholder="Short comment on the match" aria-label="Comment" />
        <button className="ghost" style={{ flex: "none" }} aria-label="Send comment">Send</button>
      </form>
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
          {commentary.length > 0 && (
            <>
              <h2>Commentary</h2>
              {commentary.slice(0, 8).map((line, i) => (
                <div key={i} className="py-2 border-b border-white/5"><span className="small">{line.over}</span> {lang === "hi" ? line.textHi : line.text}</div>
              ))}
            </>
          )}
          {(match.venue || match.city) && (
            <>
              <h2>Venue</h2>
              <p className="small">{[match.venue, match.city].filter(Boolean).join(", ")}{match.pitch ? `. ${match.pitch}` : ""}</p>
            </>
          )}
          {(match.h2h?.played || 0) > 0 && (
            <>
              <h2>Head to head</h2>
              <p className="small">{match.h2h?.played} played · {match.teams.a.code} {match.h2h?.aWins} · {match.teams.b.code} {match.h2h?.bWins}. {match.h2h?.last}</p>
            </>
          )}
          {points.length > 0 && (
            <>
              <h2>Points</h2>
              {points.map((row) => <div key={row.team} className="board"><b>{row.team}</b><span>{row.pts}</span><span>{row.nrr}</span></div>)}
            </>
          )}
          {xiCount > 0 && (
            <>
              <h2>Playing XI</h2>
              <button className="ghost" onClick={async () => {
                const ids = [...(match.xi?.a || []), ...(match.xi?.b || [])].slice(0, 11).map((p) => p.id);
                if (ids.length === 11) await api(`/api/matches/${match.key}/xi`, { method: "POST", body: JSON.stringify({ playerIds: ids }) });
                toast(ids.length === 11 ? "⭐ Fan XI saved" : "XI not announced yet");
              }}>Save fan XI</button>
              <div className="chips">
                {match.xi?.a.map((p) => <span key={p.id} className="chip">{p.look ? <Avatar look={p.look} size={28} /> : p.role} {p.name.split(" ").slice(-1)}</span>)}
              </div>
              <div className="chips">
                {match.xi?.b.map((p) => <span key={p.id} className="chip">{p.look ? <Avatar look={p.look} size={28} /> : p.role} {p.name.split(" ").slice(-1)}</span>)}
              </div>
            </>
          )}
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
      <AdSlot slot="powered_by" matchKey={match.key} quiet />
    </>
  );
}

function Charts({ match }: { match: Match }) {
  const mans = (match.manhattan || []).filter((m) => m.innings === (match.live ? 2 : 1));
  const max = Math.max(1, ...mans.map((m) => m.runs));
  const worm = match.worm || [];
  const maxW = Math.max(1, ...worm.map((w) => w.runs));
  const wagon = match.wagon || [];
  if (!mans.length && !worm.length && !wagon.length) return <Empty icon="📊" title="Charts arrive with the first over" text="Manhattan, worm and wagon wheel fill in as the match is played." />;
  return (
    <>
      {mans.length > 0 && (
        <>
          <h2>Manhattan</h2>
          <svg className="chart" viewBox="0 0 300 120">
            {mans.map((m, i) => <rect key={i} x={i * 14} y={110 - (m.runs / max) * 100} width="10" height={(m.runs / max) * 100} fill={m.wickets ? "#ff5d7a" : "#e7ff4d"} />)}
          </svg>
        </>
      )}
      {worm.length > 0 && (
        <>
          <h2>Worm</h2>
          <svg className="chart" viewBox="0 0 300 120">
            <polyline fill="none" stroke="#8ee7ff" strokeWidth="2" points={worm.filter((w) => w.innings === 1).map((w, i) => `${i * 14},${110 - (w.runs / maxW) * 100}`).join(" ")} />
            <polyline fill="none" stroke="#e7ff4d" strokeWidth="2" points={worm.filter((w) => w.innings === 2).map((w, i) => `${i * 14},${110 - (w.runs / maxW) * 100}`).join(" ")} />
          </svg>
        </>
      )}
      {wagon.length > 0 && (
        <>
          <h2>Wagon</h2>
          <svg className="chart" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.2)" />
            {wagon.map((w, i) => <circle key={i} cx={w.x} cy={w.y} r={w.runs >= 6 ? 2.4 : 1.6} fill={w.wicket ? "#ff5d7a" : w.runs >= 4 ? "#e7ff4d" : "#8ee7ff"} />)}
          </svg>
        </>
      )}
    </>
  );
}

const CHEERS = ["🔥", "👏", "😱", "💚", "🎺"];

function FanMeter({ matchKey, lang }: { matchKey: string; lang: string }) {
  const [data, setData] = useState<any>(null);
  const [note, setNote] = useState("");
  async function load() { setData(await api(`/api/matches/${matchKey}/fans`)); }
  useEffect(() => { load().catch(() => undefined); const id = setInterval(() => load().catch(() => undefined), 4000); return () => clearInterval(id); }, [matchKey]);
  if (!data) return null;
  const total = Math.max(1, data.a + data.b);
  async function pick(teamKey: string) {
    await api("/api/fan", { method: "POST", body: JSON.stringify({ teamKey }) });
    toast("📣 You picked your side");
    load();
  }
  async function cheer(emoji: string) {
    try {
      await api(`/api/matches/${matchKey}/cheer`, { method: "POST", body: JSON.stringify({ emoji }) });
      toast(`${emoji} Cheer sent`);
      load();
    } catch (err: any) { setNote(err.message); toast(err.message, "err"); }
  }
  return (
    <section className="card" aria-label={t(lang, "fans")}>
      <div className="row"><b>{t(lang, "fans")}</b><span className="small">{data.you ? "Your side" : "Pick a side"}</span></div>
      <div className="win" aria-hidden="true">
        <i style={{ width: `${(data.a / total) * 100}%`, background: data.teams.a.color }} />
        <i style={{ width: `${(data.b / total) * 100}%`, background: data.teams.b.color }} />
      </div>
      <div className="row small"><span className="flagline"><Flag code={data.teams.a.code} size={20} /> {data.a}</span><span className="flagline">{data.b} <Flag code={data.teams.b.code} size={20} /></span></div>
      <div className="chips">
        {[data.teams.a, data.teams.b].map((team: any) => (
          <button key={team.key} className={`chip team ${(data.you === "a" && team.key === data.teams.a.key) || (data.you === "b" && team.key === data.teams.b.key) ? "on" : ""}`} style={{ borderColor: team.color }} onClick={() => pick(team.key)}><Flag code={team.code} size={18} /> {team.code}</button>
        ))}
      </div>
      <div className="pills" aria-label={t(lang, "cheer")}>
        {CHEERS.map((emoji) => <button key={emoji} className="pill" onClick={() => cheer(emoji)} aria-label={`${t(lang, "cheer")} ${emoji}`}>{emoji}</button>)}
      </div>
      {note && <p className="small">{note}</p>}
    </section>
  );
}

function MiniPlay({ matchKey, lang }: { matchKey: string; lang: string }) {
  const [data, setData] = useState<any>(null);
  const [guess, setGuess] = useState("90");
  const [note, setNote] = useState("");
  async function load() { setData(await api(`/api/matches/${matchKey}/play`)); }
  useEffect(() => { load().catch(() => undefined); const id = setInterval(() => load().catch(() => undefined), 5000); return () => clearInterval(id); }, [matchKey]);
  if (!data || (!data.trivia && !data.overs10)) return null;
  return (
    <section className="card">
      <h2>Break games</h2>
      <p className="small">Free. Points only. No cash.</p>
      {data.trivia && (
        <div>
          <p>{lang === "hi" ? data.trivia.promptHi : data.trivia.prompt}</p>
          {data.trivia.mine ? <p className="small">Locked · {data.trivia.mine.points} pts</p> : (
            <div className="chips">
              {data.trivia.options.map((opt: string) => (
                <button key={opt} className="chip" onClick={async () => {
                  const res = await api<any>(`/api/matches/${matchKey}/play`, { method: "POST", body: JSON.stringify({ kind: "trivia", pick: opt }) });
                  setNote(res.correct ? `Correct · ${res.points} pts` : `Answer: ${res.answer}`);
                  toast(res.correct ? `✅ Correct · +${res.points}` : `❌ Answer: ${res.answer}`);
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
              toast("🔒 Guess locked");
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
      <p className="small">Opens late. The result is fans versus the stats card. Points only.</p>
      {data.categories.map((c: any) => (
        <div key={c.id}>
          <div className="small">{c.emoji} {c.label}{c.fan ? ` · fans ${c.fan} · stats ${c.stats}` : ""}</div>
          {!c.yours && (
            <div className="chips">
              {data.players.slice(0, 6).map((p: { id: string; name: string }) => (
                <button key={p.id} className="chip" onClick={async () => { setData(await api(`/api/matches/${matchKey}/vote`, { method: "POST", body: JSON.stringify({ category: c.id, playerId: p.id }) })); toast(`🗳️ Vote locked: ${p.name}`); }}>{p.name.split(" ").slice(-1)}</button>
              ))}
            </div>
          )}
          {c.yours && <p className="small">✅ Your vote is locked</p>}
        </div>
      ))}
    </section>
  );
}

function Chat({ matchKey }: { matchKey: string }) {
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  async function load() { setData(await api(`/api/chat/${matchKey}`)); }
  useEffect(() => { load().catch(() => undefined); const id = setInterval(() => load().catch(() => undefined), 3000); return () => clearInterval(id); }, [matchKey]);
  async function sendReaction(emoji: string) {
    await api(`/api/chat/${matchKey}/react`, { method: "POST", body: JSON.stringify({ emoji }) });
    toast(`${emoji} Reaction sent`);
    await load();
  }
  return (
    <div>
      <div className="pills">
        {Object.entries(data?.reactions || {}).map(([emoji, n]) => (
          <button key={emoji} className="pill" onClick={() => sendReaction(emoji)}>{emoji} {String(n)}</button>
        ))}
        {["🔥", "👏", "😱"].filter((emoji) => !(emoji in (data?.reactions || {}))).map((emoji) => (
          <button key={emoji} className="pill" onClick={() => sendReaction(emoji)}>{emoji}</button>
        ))}
      </div>
      <div className="chat mt-3">
        {data && !(data.messages || []).length && <Empty icon="🎉" title="Start the watch party" text="Be the first to say something about this match. Keep it friendly." />}
        {(data?.messages || []).map((m: any) => (
          <div key={m.id} className="who">{m.look && <Avatar look={m.look} size={32} />}<div><b className="small">{m.name}</b><div>{m.body}</div></div></div>
        ))}
      </div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await api(`/api/chat/${matchKey}`, { method: "POST", body: JSON.stringify({ body: text }) });
        setText("");
        toast("💬 Sent to the watch party");
        load();
      }} className="flex gap-2 mt-2">
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something to the watch party" />
        <button className="primary" style={{ width: "auto", padding: "0 18px" }} disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
