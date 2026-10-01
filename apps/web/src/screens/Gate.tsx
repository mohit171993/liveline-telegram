import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Me } from "../lib";

const privacy = `LiveLine Pro stores only what Telegram gives us (ID, name, username, language, Premium flag) and the phone number you choose to share with Telegram's contact button. We use it to keep one account per person, send reminders, and deliver gift vouchers to that number. We never read your phone book. Points, spins and vouchers have no cash value. There is no betting.`;

export function Gate({ mode, me, message, onDone }: { mode: "outside" | "register" | "blocked" | "error"; me?: Me; message?: string; onDone?: (me: Me) => void }) {
  const [terms, setTerms] = useState(false);
  const [note, setNote] = useState("");
  const nav = useNavigate();
  if (mode === "outside") {
    return (
      <div className="gate">
        <div>
          <img className="mx-auto" src="/brand/logo.svg" width="280" height="50" alt="LiveLine Pro" />
          <h1>LIVELINE</h1>
          <p>Scores stay inside Telegram. Nothing here is public.</p>
          <a className="primary inline-block" href="https://t.me/LiveLineProBot">Open in Telegram</a>
        </div>
      </div>
    );
  }
  if (mode === "blocked") return <div className="gate"><h1>Blocked</h1><p>An admin has paused this account.</p></div>;
  if (mode === "error") return <div className="gate"><h1>LiveLine</h1><p>{message}</p></div>;
  return (
    <div className="app">
      {me?.user.admin && (
        <button className="admin-tile" onClick={() => nav("/admin")}>
          <span className="admin-tile-icon">🛠</span>
          <span><b>Admin panel</b><small>You're on the admin list: open it now, verify later.</small></span>
          <span className="admin-tile-go">›</span>
        </button>
      )}
      <h1 className="font-display text-5xl">Verify</h1>
      <p className="small">{privacy}</p>
      <label className="flex gap-2 items-start mt-4"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> <span>{me?.user.language === "hi" ? "मैं नियम और गोपनीयता सूचना मानता हूँ" : "I agree to the terms and privacy notice"}</span></label>
      <button className="primary" disabled={!terms} onClick={async () => {
        await api("/api/auth/terms", { method: "POST", body: JSON.stringify({ accepted: true }) });
        window.Telegram?.WebApp?.requestContact?.(() => undefined);
        setNote("If Telegram asks, share your own phone. We'll check it belongs to this account.");
        const tick = setInterval(async () => {
          const next = await api<Me>("/api/me");
          if (next.user.registered && onDone) { clearInterval(tick); onDone(next); }
        }, 2000);
      }}>Share phone & continue</button>
      {note && <p className="small">{note}</p>}
    </div>
  );
}

export function AgeGate({ onDone }: { me?: Me; onDone?: (me: Me) => void }) {
  const [year, setYear] = useState(2000);
  const [parent, setParent] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="app">
      <h1 className="font-display text-5xl">Age check</h1>
      <p className="small">LiveLine is 18+. If you are 13 to 17, a parent has to consent. We store the birth year only, under India's DPDP Act. Points, chips, packs and tickets cannot be bought.</p>
      <label className="small">Birth year</label>
      <input className="field" type="number" min={1920} max={2026} value={year} onChange={(e) => setYear(Number(e.target.value))} />
      <label className="flex gap-2 items-start mt-3"><input type="checkbox" checked={parent} onChange={(e) => setParent(e.target.checked)} /> <span>A parent or guardian consents for a player under 18</span></label>
      <button className="primary" onClick={async () => {
        try {
          const next = await api<Me>("/api/auth/age", { method: "POST", body: JSON.stringify({ birthYear: year, parentConsent: parent }) });
          onDone?.(next);
        } catch (err) {
          setNote(err instanceof Error ? err.message : "Could not confirm age");
        }
      }}>Continue</button>
      {note && <p className="err">{note}</p>}
    </div>
  );
}

export function AdvertisePage() {
  const [done, setDone] = useState(false);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      await api("/api/advertise/lead", { method: "POST", body: JSON.stringify(Object.fromEntries(fd.entries())) });
      setDone(true);
    }}>
      <h2>Advertise with us</h2>
      <p className="small">Home native, prediction slot, innings interstitial, powered-by, or a free spin sponsor. No betting brands.</p>
      <div className="card"><b>Rate card</b><p className="small">Home native from ₹15,000 / week. Match sponsor from ₹40,000. Spin sponsor from ₹25,000. Final quote on request.</p></div>
      <input className="field" name="name" placeholder="Your name" required />
      <input className="field" name="brand" placeholder="Brand" required />
      <input className="field" name="contact" placeholder="Phone or email" required />
      <input className="field" name="budget" placeholder="Budget" />
      <textarea className="area" name="message" placeholder="What do you want to run?" required />
      <button className="primary">Send to the team</button>
      {done && <p>Sent. An admin has the lead on Telegram.</p>}
    </form>
  );
}
