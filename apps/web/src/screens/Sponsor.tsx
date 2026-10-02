import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, haptic, toast } from "../lib";
import { AdminNav, Toggle, ist } from "./Crm";

export type PublicSponsor = { id: string; text: string; emoji: string; style: "success" | "primary" | "danger" | "default"; url: string; frameable: boolean; go?: string };

const label = (s: { emoji: string; text: string }) => `${s.emoji ? `${s.emoji} ` : ""}${s.text}`;

/* ---------------------------------------------------------------- Home banner */

export function SponsorBanner() {
  const [rows, setRows] = useState<PublicSponsor[]>([]);
  const nav = useNavigate();
  useEffect(() => { api<{ sponsors: PublicSponsor[] }>("/api/sponsors").then((r) => setRows(r.sponsors)).catch(() => undefined); }, []);
  if (!rows.length) return null;
  return (
    <div className="sponsor-stack">
      {rows.map((s) => (
        <button key={s.id} className={`sponsor-banner sp-${s.style}`} onClick={() => openSponsor(s, nav)}>
          <span className="sp-emoji">{s.emoji || "⭐"}</span>
          <span className="sp-text"><b>{s.text}</b><small>Sponsored</small></span>
          <span className="sp-go">›</span>
        </button>
      ))}
    </div>
  );
}

/**
 * One tap from the Home tile: the current Mini App webview navigates straight to the sponsor site
 * (through the api's tracking 302), so it stays inside Telegram — never the external browser.
 */
function openSponsor(s: PublicSponsor, nav: (to: string) => void) {
  haptic("medium");
  if (s.go) { window.location.assign(s.go); return; }
  api(`/api/sponsors/${s.id}/tap`, { method: "POST", body: JSON.stringify({ surface: "home" }) }).catch(() => undefined);
  if (/^https:\/\//.test(s.url)) window.location.assign(s.url);
  else nav(`/sponsor/${s.id}?src=home`);
}

/* ---------------------------------------------------------------- In-app sponsor view */

export function SponsorView() {
  const { id = "" } = useParams();
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const [s, setS] = useState<PublicSponsor | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    api<PublicSponsor>(`/api/sponsors/${id}`).then((row) => {
      if (!alive) return;
      setS(row);
      const surface = qs.get("src") === "bot" ? "bot" : "home";
      api(`/api/sponsors/${id}/tap`, { method: "POST", body: JSON.stringify({ surface }) }).catch(() => undefined);
      // Older /start buttons still land here: go straight to the sponsor inside this webview.
      if (/^https:\/\//.test(row.url)) window.location.replace(row.url);
    }).catch((e) => alive && setErr(e instanceof Error ? e.message : "This offer has ended."));
    return () => { alive = false; };
  }, [id]);
  const open = () => s && window.location.assign(s.url);
  if (err) return <div className="sponsor-view"><p className="err">{err}</p><button className="ghost w-full" onClick={() => nav("/")}>Back to LiveLine</button></div>;
  if (!s) return <div className="sponsor-view"><div className="skel" /></div>;
  return (
    <div className="sponsor-view">
      <div className="sp-bar">
        <button className="textlink" onClick={() => nav("/")}>‹ LiveLine</button>
        <span className="sp-tag">Sponsored · {label(s)}</span>
        <button className="chip" onClick={open}>Open ↗</button>
      </div>
      {s.frameable ? (
        <div className="sp-frame-wrap">
          {!loaded && <div className="skel sp-frame-skel" />}
          <iframe className="sp-frame" src={s.url} title={s.text} onLoad={() => setLoaded(true)} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      ) : (
        <div className="card sp-external">
          <div className="sp-emoji big">{s.emoji || "⭐"}</div>
          <b>{s.text}</b>
          <p className="small">Opened in Telegram's browser. Didn't open?</p>
          <button className={`sponsor-banner sp-${s.style}`} onClick={open}><span className="sp-text"><b>Open {s.text}</b></span><span className="sp-go">↗</span></button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Admin */

type AdminSponsor = PublicSponsor & {
  enabled: boolean; target: "verified" | "all"; startsAt: string | null; endsAt: string | null; frameNote: string; live: boolean; sort: number;
  stats?: { total: number; d1: number; d7: number; uniq: number; bot: number; home: number };
};
type Form = { id?: string; text: string; emoji: string; style: PublicSponsor["style"]; url: string; enabled: boolean; target: "verified" | "all"; startsAt: string; endsAt: string; sort: number };
const EMPTY: Form = { text: "", emoji: "🎁", style: "success", url: "https://", enabled: true, target: "verified", startsAt: "", endsAt: "", sort: 0 };
const STYLES: { id: PublicSponsor["style"]; name: string }[] = [
  { id: "success", name: "Green" }, { id: "primary", name: "Blue" }, { id: "danger", name: "Red" }, { id: "default", name: "Default" },
];
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function SponsorsAdmin() {
  const [data, setData] = useState<{ max: number; note: string; sponsors: AdminSponsor[] } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api("/api/admin/sponsors").then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Admin only"));
  useEffect(() => { load(); }, []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form) return;
    setSaving(true); setErr("");
    const body = {
      text: form.text, emoji: form.emoji, style: form.style, url: form.url.trim(), enabled: form.enabled, target: form.target, sort: Number(form.sort) || 0,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null, endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    };
    try {
      const row = await api<AdminSponsor>(form.id ? `/api/admin/sponsors/${form.id}` : "/api/admin/sponsors", { method: form.id ? "PUT" : "POST", body: JSON.stringify(body) });
      toast(row.frameable ? "Saved ✅" : "Saved. This site blocks embedding, it will open in Telegram's browser.", row.frameable ? "ok" : "err");
      setForm(null); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
    setSaving(false);
  }
  async function toggle(s: AdminSponsor, enabled: boolean) {
    try {
      await api(`/api/admin/sponsors/${s.id}`, { method: "PUT", body: JSON.stringify({ text: s.text, emoji: s.emoji, style: s.style, url: s.url, enabled, target: s.target, sort: s.sort, startsAt: s.startsAt, endsAt: s.endsAt }) });
      toast(enabled ? "Sponsor on" : "Sponsor off"); load();
    } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  async function remove(s: AdminSponsor) {
    if (!window.confirm(`Delete "${label(s)}"? Tap history goes too.`)) return;
    await api(`/api/admin/sponsors/${s.id}`, { method: "DELETE" }).catch(() => undefined);
    toast("Deleted"); load();
  }

  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>Sponsor buttons</h2>{!form && <button className="chip on" onClick={() => { haptic("light"); setForm({ ...EMPTY }); setErr(""); }}>＋ New</button>}</div>
      <p className="small">Shows as the first, full-width button in the verified /start grid and as a banner at the top of Home. Up to {data?.max ?? 3} on at once.</p>
      <p className="sp-legal">⚖️ {data?.note || "Use legal brands only. No betting or real-money gaming."}</p>
      {form && (
        <div className="card sp-form">
          <h3>{form.id ? "Edit sponsor" : "New sponsor"}</h3>
          <label className="small">Button text</label>
          <input className="field" maxLength={40} value={form.text} placeholder="Get 20% off cricket gear" onChange={(e) => set("text", e.target.value)} />
          <div className="sp-two">
            <div><label className="small">Emoji</label><input className="field" maxLength={8} value={form.emoji} onChange={(e) => set("emoji", e.target.value)} /></div>
            <div><label className="small">Order</label><input className="field" type="number" min={0} max={99} value={form.sort} onChange={(e) => set("sort", Number(e.target.value))} /></div>
          </div>
          <label className="small">Colour (Telegram button style)</label>
          <div className="seg sp-colours">{STYLES.map((c) => <button key={c.id} className={`${form.style === c.id ? "on" : ""} swatch-${c.id}`} onClick={() => set("style", c.id)}>{c.name}</button>)}</div>
          <label className="small">Link (https)</label>
          <input className="field" inputMode="url" value={form.url} onChange={(e) => set("url", e.target.value)} />
          <label className="small">Who sees it</label>
          <div className="seg">{(["verified", "all"] as const).map((t) => <button key={t} className={form.target === t ? "on" : ""} onClick={() => set("target", t)}>{t === "verified" ? "Verified users" : "Everyone"}</button>)}</div>
          <div className="sp-two dates">
            <div><label className="small">Start (optional)</label><input className="field" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
            <div><label className="small">End (optional)</label><input className="field" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
          </div>
          <div className="row sp-on"><b>On</b><Toggle on={form.enabled} onChange={(v) => set("enabled", v)} label="On" /></div>
          <label className="small">Preview</label>
          <div className={`sp-btn sp-${form.style}`}>{label({ emoji: form.emoji, text: form.text || "Button text" })}</div>
          {err && <p className="err">{err}</p>}
          <div className="sp-two"><button className="ghost" onClick={() => { setForm(null); setErr(""); }}>Cancel</button><button className="primary" disabled={saving || form.text.trim().length < 2} onClick={save}>{saving ? "Checking link…" : "Save"}</button></div>
        </div>
      )}
      {!data ? <div className="skel" /> : data.sponsors.length === 0 && !form ? <p className="small">No sponsor buttons yet.</p> : data.sponsors.map((s) => (
        <div key={s.id} className="card rule sp-row">
          <div className="row">
            <div className={`sp-btn sp-${s.style} sp-mini`}>{label(s)}</div>
            <Toggle on={s.enabled} onChange={(v) => toggle(s, v)} label="On" />
          </div>
          <p className="small sp-url">{s.url}</p>
          <p className="small">{s.live ? "🟢 Live" : s.enabled ? "🕒 Scheduled / ended" : "⚪ Off"} · {s.target === "all" ? "Everyone" : "Verified users"}{s.startsAt ? ` · from ${ist(s.startsAt)}` : ""}{s.endsAt ? ` · until ${ist(s.endsAt)}` : ""}</p>
          {!s.frameable && <p className="sp-warn">⚠️ {s.frameNote || "This site blocks embedding."}</p>}
          <div className="sp-stats"><span><b>{s.stats?.d1 ?? 0}</b> taps 24h</span><span><b>{s.stats?.d7 ?? 0}</b> 7d</span><span><b>{s.stats?.total ?? 0}</b> 90d</span><span><b>{s.stats?.uniq ?? 0}</b> users</span><span>🤖 {s.stats?.bot ?? 0} · 🏠 {s.stats?.home ?? 0}</span></div>
          <div className="sp-two">
            <button className="ghost" onClick={() => { setErr(""); setForm({ id: s.id, text: s.text, emoji: s.emoji, style: s.style, url: s.url, enabled: s.enabled, target: s.target, startsAt: toLocal(s.startsAt), endsAt: toLocal(s.endsAt), sort: s.sort }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
            <button className="ghost danger" onClick={() => remove(s)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Reports / Funnel: sponsor taps table. */
export function SponsorTapsTable({ rows }: { rows?: { id: string; label: string; taps: number; users: number; verifiedUsers: number; bot: number; home: number; live: boolean }[] }) {
  if (!rows) return null;
  return (
    <div>
      <h3>💚 Sponsor button taps</h3>
      {rows.length === 0 ? <p className="small">No sponsor taps in this window.</p> : (
        <div className="table-wrap">
          <table className="attr">
            <thead><tr><th>Sponsor</th><th>Taps</th><th>Users</th><th>Verified</th><th>Bot / Home</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{r.label}{r.live ? " 🟢" : ""}</td><td>{r.taps}</td><td>{r.users}</td><td>{r.verifiedUsers}</td><td>{r.bot} / {r.home}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
