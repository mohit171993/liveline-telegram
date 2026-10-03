import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Me } from "../lib";

const privacy = `LiveLine Pro stores only what Telegram gives us (ID, name, username, language, Premium flag) and the phone number you choose to share with Telegram's contact button. We use it to keep one account per person, send reminders, and keep the leaderboard fair. We never read your phone book. Points and XP are only for levels and the leaderboard: no money value, nothing to redeem. There is no betting.`;

export function Gate({ mode, me, message, onDone }: { mode: "outside" | "register" | "blocked" | "error"; me?: Me; message?: string; onDone?: (me: Me) => void }) {
  const [busy, setBusy] = useState(false);
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
  const tg = window.Telegram?.WebApp;
  const canAsk = Boolean(tg?.requestContact) && (tg?.isVersionAtLeast ? tg.isVersionAtLeast("6.9") : true);
  const waitForRegistered = () => {
    let n = 0;
    const tick = setInterval(async () => {
      n += 1;
      const next = await api<Me>("/api/me").catch(() => null);
      if (next?.user.registered) { clearInterval(tick); nav("/", { replace: true }); onDone?.(next); }
      else if (n > 45) { clearInterval(tick); setBusy(false); setNote("Still waiting for your phone. Tap ✅ Share phone to verify in the chat, then reopen LiveLine."); }
    }, 2000);
  };
  const verifyNow = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    try {
      // The tap accepts the terms and confirms 18+ (shown right under the button).
      await api("/api/auth/onetap", { method: "POST", body: JSON.stringify({ accepted: true, adult: true }) });
      if (!me?.user.needsPhone) { const next = await api<Me>("/api/me"); nav("/", { replace: true }); onDone?.(next); return; }
      if (!canAsk) { setBusy(false); setNote("Your Telegram app is too old for in-app sharing. Close this and tap ✅ Share phone to verify in the chat."); return; }
      tg!.requestContact!(async (ok, res) => {
        if (!ok) { setBusy(false); setNote("No problem. Tap ✅ Verify now again whenever you're ready, or use the green button in the chat."); return; }
        setNote("Verifying…");
        if (res?.response) {
          try {
            const r = await api<{ user: Me["user"] }>("/api/auth/contact", { method: "POST", body: JSON.stringify({ response: res.response }) });
            if (r.user.registered) { const next = await api<Me>("/api/me"); nav("/", { replace: true }); onDone?.(next); return; }
          } catch (err) {
            setNote(err instanceof Error ? err.message : "Could not verify that contact.");
          }
        }
        waitForRegistered(); // the bot also receives the contact and verifies it
      });
    } catch (err) {
      setBusy(false);
      setNote(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };
  return (
    <div className="app verify-gate">
      {me?.user.admin && (
        <button className="admin-tile" onClick={() => nav("/admin")}>
          <span className="admin-tile-icon">🛠</span>
          <span><b>Admin panel</b><small>You're on the admin list: open it now, verify later.</small></span>
          <span className="admin-tile-go">›</span>
        </button>
      )}
      <div className="vg-hero">
        <div className="vg-shield">🔐</div>
        <h1 className="font-display">VERIFY YOUR <span>PHONE</span></h1>
        <p>1 tap to unlock Live line, Alerts, Predict &amp; Lino</p>
      </div>
      <ul className="vg-perks">
        <li>⚡ <b>Live line</b>, ball by ball</li>
        <li>🎯 <b>Free predictions</b> &amp; points leaderboard</li>
        <li>🔔 <b>Match alerts</b> &amp; Lino, your AI buddy</li>
      </ul>
      <button className="vg-cta" disabled={busy} onClick={verifyNow}>{busy ? "Waiting for Telegram…" : "✅ Verify now"}</button>
      <p className="vg-legal">By tapping you confirm you're <b>18+</b> and accept the terms and privacy notice. Telegram shares your number, nothing to type.</p>
      {note && <p className="vg-note">{note}</p>}
      <details className="vg-privacy"><summary>Privacy notice</summary><p className="small">{privacy}</p></details>
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
      <p className="small">Home native, prediction slot, innings interstitial, powered-by, or a Daily XP Spin sponsor. No betting brands.</p>
      <div className="card"><b>Rate card</b><p className="small">Home native from ₹15,000 / week. Match sponsor from ₹40,000. XP Spin sponsor from ₹25,000. Final quote on request.</p></div>
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
