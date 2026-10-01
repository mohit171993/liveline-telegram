import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, t } from "../lib";

export function BuddyPage({ lang }: { lang: string }) {
  const { key = "" } = useParams();
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ role: string; text: string }[]>([
    { role: "bot", text: lang === "hi" ? "स्कोर, पीछा या खिलाड़ी पूछें। सट्टे पर बात नहीं।" : "Ask about the score, the chase, or the players. No betting." },
  ]);
  return (
    <>
      <h2>{t(lang, "ai")}</h2>
      <p className="small">Sports only · not betting advice</p>
      <div className="chat">
        {log.map((line, i) => <div key={i} className={`bubble ${line.role === "me" ? "me" : ""}`}>{line.text}</div>)}
      </div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const message = text.trim();
        if (!message) return;
        setLog((cur) => [...cur, { role: "me", text: message }]);
        setText("");
        try {
          const res = await api<{ text: string; stub: boolean }>("/api/ai/chat", { method: "POST", body: JSON.stringify({ matchKey: key, message }) });
          setLog((cur) => [...cur, { role: "bot", text: res.text + (res.stub ? "" : "") }]);
        } catch (err: any) {
          setLog((cur) => [...cur, { role: "bot", text: err.message }]);
        }
      }}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === "hi" ? "रन रेट क्या है?" : "What's the required rate?"} />
      </form>
    </>
  );
}
