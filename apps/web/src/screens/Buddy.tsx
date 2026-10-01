import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, t } from "../lib";
import { Mascot } from "../brand/Brand";

export function BuddyPage({ lang }: { lang: string }) {
  const params = useParams();
  const [key, setKey] = useState(params.key || "");
  const [matchName, setMatchName] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    // Opened from the bot (startapp=lino) or the Home quick action: talk about the live match.
    api<{ matches: any[] }>("/api/home").then(({ matches }) => {
      const m = matches.find((x) => x.key === key) || matches.find((x) => x.status === "live") || matches.find((x) => x.status === "upcoming") || matches[0];
      if (m) { if (!key) setKey(m.key); setMatchName(m.name || `${m.teams.a.name} v ${m.teams.b.name}`); }
    }).catch(() => undefined);
  }, []);
  const [log, setLog] = useState<{ role: string; text: string }[]>([
    { role: "bot", text: lang === "hi" ? "स्कोर, पीछा या खिलाड़ी पूछें। सट्टे पर बात नहीं।" : "Ask about the score, the chase, or the players. No betting." },
  ]);
  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setLog((cur) => [...cur, { role: "me", text: message }]);
    setText("");
    setBusy(true);
    try {
      const res = await api<{ text: string; stub: boolean }>("/api/ai/chat", { method: "POST", body: JSON.stringify({ matchKey: key, message }) });
      setLog((cur) => [...cur, { role: "bot", text: res.text }]);
    } catch (err: any) {
      setLog((cur) => [...cur, { role: "bot", text: err.message }]);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <>
      <div className="page-head" style={{ justifyContent: "flex-start" }}><Mascot size={48} /><h2>{lang === "hi" ? "लिनो से पूछें" : "Ask Lino"}</h2></div>
      <p className="small">{matchName ? `Talking about ${matchName} · ` : ""}Sports only · not betting advice</p>
      <div className="chat">
        {log.map((line, i) => <div key={i} className={`bubble ${line.role === "me" ? "me" : ""}`}>{line.text}</div>)}
        {busy && <div className="bubble">Lino is typing…</div>}
        <div ref={end} />
      </div>
      <div className="chips">
        {(lang === "hi" ? ["रन रेट क्या है?", "कौन जीतेगा?", "मैच का हाल"] : ["What's the required rate?", "Who's on top?", "Sum up the match"]).map((q) => (
          <button key={q} className="chip" disabled={busy} onClick={() => send(q)}>{q}</button>
        ))}
      </div>
      <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === "hi" ? "रन रेट क्या है?" : "Ask about the match…"} />
        <button className="primary" style={{ width: "auto", padding: "0 18px" }} disabled={busy || !text.trim()}>Send</button>
      </form>
    </>
  );
}
