import { useEffect, useState } from "react";
import { api, apiBase, haptic, initData, toast } from "../lib";
import { AdminNav, Toggle, ist } from "./Crm";
import { mediaSrc, type AdUnit } from "./AdUnits";
import { BulkUpload, CreativeLibrary, type LibAd } from "./AdsBulk";

type Kind = AdUnit["kind"];
type Pos = "top" | "infeed" | "sticky" | "interstitial";
type Stat = { i: number; c: number };
type AdminAd = AdUnit & {
  name: string; html: string; placements: string[]; pages: string[]; startsAt: number | null; endsAt: number | null;
  priority: number; weight: number; enabled: boolean; live: boolean; stats: { today: Stat; d7: Stat; d30: Stat };
};
type Form = {
  id?: string; name: string; kind: Kind; title: string; body: string; cta: string; images: Partial<Record<"default" | Pos, string>>;
  videoUrl: string; posterUrl: string; html: string; targetUrl: string; openMode: "inapp" | "external"; placements: string[]; pages: string[];
  startsAt: string; endsAt: string; priority: number; weight: number; freqCap: number; enabled: boolean;
};

const KINDS: { id: Kind; label: string; icon: string }[] = [
  { id: "banner", label: "Banner", icon: "🖼" }, { id: "native", label: "Native", icon: "📰" },
  { id: "video", label: "Video", icon: "🎬" }, { id: "html", label: "HTML / script", icon: "</>" },
];
const POS: { id: Pos; label: string; size: string }[] = [
  { id: "top", label: "Top leaderboard", size: "728×90 · 320×100" },
  { id: "infeed", label: "In-feed", size: "1200×628 · 300×250" },
  { id: "sticky", label: "Sticky bottom", size: "320×50 · 728×90" },
  { id: "interstitial", label: "Interstitial", size: "1080×1920 · 320×480" },
];
const PAGES = [{ id: "home", label: "Home" }, { id: "match", label: "Live match" }, { id: "schedule", label: "Schedule" }, { id: "lino", label: "Lino" }];
const EMPTY: Form = {
  name: "", kind: "banner", title: "", body: "", cta: "", images: {}, videoUrl: "", posterUrl: "", html: "", targetUrl: "", openMode: "inapp",
  placements: ["site_infeed", "app_infeed"], pages: [], startsAt: "", endsAt: "", priority: 0, weight: 1, freqCap: 1, enabled: false,
};
const toLocal = (ms: number | null) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const pct = (s: Stat) => (s.i ? `${((s.c / s.i) * 100).toFixed(1)}%` : "–");
const placeLabel = (p: string) => `${p.startsWith("site_") ? "🌐" : "📱"} ${POS.find((x) => x.id === p.split("_")[1])?.label || p}`;

async function upload(file: File, kind: "image" | "video"): Promise<string> {
  const max = kind === "video" ? 20 : 3;
  if (file.size > max * 1024 * 1024) throw new Error(kind === "video" ? "Videos can be up to 20 MB." : "Images can be up to 3 MB.");
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch(`${apiBase()}/api/admin/adunits/media`, { method: "POST", headers: { authorization: `tma ${initData()}` }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Upload failed");
  return data.url as string;
}

function Upload({ label, hint, value, accept, kind, onChange }: { label: string; hint?: string; value: string; accept: string; kind: "image" | "video"; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <label className="small">{label}{hint ? <span className="muted"> · {hint}</span> : null}</label>
      <div className="am-upload">
        {value && (kind === "video" ? <video src={mediaSrc(value)} muted playsInline /> : <img src={mediaSrc(value)} alt="" />)}
        <input className="field" readOnly value={value ? value.split("/").pop() : ""} placeholder="No file yet" />
        <span className="ghost am-file">{busy ? "Uploading…" : value ? "Replace" : "Upload"}
          <input type="file" accept={accept} disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            try { onChange(await upload(f, kind)); toast("Uploaded ✅"); } catch (err) { toast(err instanceof Error ? err.message : "Upload failed", "err"); }
            setBusy(false);
          }} />
        </span>
        {value && <button className="ghost am-file" onClick={() => onChange("")}>✕</button>}
      </div>
    </div>
  );
}

function Preview({ f }: { f: Form }) {
  const img = f.images.infeed || f.images.default || f.images.top || "";
  if (f.kind === "html") return <div className="am-preview small">HTML / script runs on the website only (preview after saving, on the site).</div>;
  if (f.kind === "video") return f.videoUrl ? <div className="am-preview"><video className="au-video" src={mediaSrc(f.videoUrl)} poster={mediaSrc(f.posterUrl) || undefined} autoPlay muted loop playsInline /></div> : null;
  if (f.kind === "native") return <div className="am-preview"><div className="au au-infeed"><div className="au-native">{img && <img src={mediaSrc(img)} alt="" />}<div><b>{f.title || "Title"}</b><p>{f.body || "Short text"}</p>{f.cta && <span className="au-cta">{f.cta}</span>}</div></div><small className="au-tag">Ad</small></div></div>;
  return img ? <div className="am-preview"><div className="au au-infeed"><img className="au-img" src={mediaSrc(img)} alt="" /><small className="au-tag">Ad</small></div></div> : null;
}

export function AdsManager() {
  const [data, setData] = useState<{ note: string; storage: string; storageOk: boolean; ads: AdminAd[] } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api("/api/admin/adunits").then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Admin only"));
  useEffect(() => { load(); }, []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const toggleIn = (k: "placements" | "pages", v: string) => setForm((f) => (f ? { ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] } : f));

  function body(f: Form) {
    return {
      name: f.name, kind: f.kind, title: f.title, body: f.body, cta: f.cta, images: f.images, videoUrl: f.videoUrl, posterUrl: f.posterUrl, html: f.html,
      targetUrl: f.targetUrl.trim(), openMode: f.openMode, placements: f.placements, pages: f.pages,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      priority: Number(f.priority) || 0, weight: Math.max(1, Number(f.weight) || 1), freqCap: Math.max(0, Number(f.freqCap) || 0), enabled: f.enabled,
    };
  }
  async function save() {
    if (!form) return;
    setSaving(true); setErr("");
    try {
      await api(form.id ? `/api/admin/adunits/${form.id}` : "/api/admin/adunits", { method: form.id ? "PUT" : "POST", body: JSON.stringify(body(form)) });
      toast("Saved ✅"); setForm(null); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
    setSaving(false);
  }
  async function toggle(a: AdminAd, enabled: boolean) {
    try { await api(`/api/admin/adunits/${a.id}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) }); toast(enabled ? "Ad on" : "Ad off"); load(); }
    catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  async function remove(a: AdminAd) {
    if (!window.confirm(`Delete "${a.name}"? Its stats go too.`)) return;
    await api(`/api/admin/adunits/${a.id}`, { method: "DELETE" }).catch(() => undefined);
    toast("Deleted"); load();
  }
  function edit(a: AdminAd) {
    setErr("");
    setForm({ id: a.id, name: a.name, kind: a.kind, title: a.title, body: a.body, cta: a.cta, images: a.images, videoUrl: a.videoUrl, posterUrl: a.posterUrl, html: a.html,
      targetUrl: a.targetUrl, openMode: a.openMode, placements: a.placements, pages: a.pages, startsAt: toLocal(a.startsAt), endsAt: toLocal(a.endsAt),
      priority: a.priority, weight: a.weight, freqCap: a.freqCap, enabled: a.enabled });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const f = form;
  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>Ads</h2>{!form && <div className="chips am-head-btns"><button className="chip" onClick={() => document.querySelector<HTMLInputElement>(".bulk-pick input")?.click()}>⬆️ Bulk upload</button><button className="chip on" onClick={() => { haptic("light"); setForm({ ...EMPTY }); setErr(""); }}>＋ New ad</button></div>}</div>
      <p className="small">Banners, native cards, video and ad-network code for the website and the Mini App. Highest priority shows first; equal priority rotates by weight.</p>
      <p className="sp-legal">⚖️ {data?.note || "Use legal brands only."}</p>
      {!form && <BulkUpload onDone={load} />}
      {data && !form && <CreativeLibrary ads={data.ads as unknown as LibAd[]} reload={load} />}
      {data && <p className="am-storage">Storage: {data.storage === "bucket" ? "Railway bucket" : "local disk (dev)"} {data.storageOk ? "✓" : "⚠️ unreachable"}</p>}
      {f && (
        <div className="card sp-form am-form">
          <h3>{f.id ? "Edit ad" : "New ad"}</h3>
          <label className="small">Name (internal)</label>
          <input className="field" maxLength={80} value={f.name} placeholder="Cricket gear – Diwali" onChange={(e) => set("name", e.target.value)} />
          <label className="small">Type</label>
          <div className="seg">{KINDS.map((k) => <button key={k.id} className={f.kind === k.id ? "on" : ""} onClick={() => set("kind", k.id)}>{k.icon} {k.label}</button>)}</div>

          {f.kind === "banner" && <>
            <Upload label="Banner image" hint="used for every size unless overridden" value={f.images.default || ""} accept="image/png,image/jpeg,image/webp,image/gif" kind="image" onChange={(v) => set("images", { ...f.images, default: v })} />
            {POS.map((p) => <Upload key={p.id} label={`${p.label} (optional)`} hint={p.size} value={f.images[p.id] || ""} accept="image/png,image/jpeg,image/webp,image/gif" kind="image" onChange={(v) => set("images", { ...f.images, [p.id]: v })} />)}
          </>}
          {f.kind === "native" && <>
            <Upload label="Image" hint="square or 1.91:1" value={f.images.default || ""} accept="image/png,image/jpeg,image/webp,image/gif" kind="image" onChange={(v) => set("images", { ...f.images, default: v })} />
          </>}
          {f.kind === "video" && <>
            <Upload label="Video (mp4 / webm, ≤ 20 MB)" hint="plays muted, looped" value={f.videoUrl} accept="video/mp4,video/webm" kind="video" onChange={(v) => set("videoUrl", v)} />
            <Upload label="Poster image" hint="shown before the video loads" value={f.posterUrl} accept="image/png,image/jpeg,image/webp" kind="image" onChange={(v) => set("posterUrl", v)} />
          </>}
          {(f.kind === "native" || f.kind === "video") && <>
            <label className="small">Title</label><input className="field" maxLength={90} value={f.title} onChange={(e) => set("title", e.target.value)} />
            <label className="small">Text</label><textarea className="area" maxLength={240} rows={2} value={f.body} onChange={(e) => set("body", e.target.value)} />
            <label className="small">Button (CTA)</label><input className="field" maxLength={30} value={f.cta} placeholder="Shop now" onChange={(e) => set("cta", e.target.value)} />
          </>}
          {f.kind === "html" && <>
            <label className="small">Ad network code (AdSense, AdMob web, etc.) — website only</label>
            <textarea className="area" rows={6} spellCheck={false} value={f.html} placeholder={'<script async src="https://pagead2.googlesyndication.com/..."></script>'} onChange={(e) => set("html", e.target.value)} />
          </>}
          {f.kind !== "html" && <>
            <label className="small">Link (https)</label>
            <input className="field" inputMode="url" value={f.targetUrl} placeholder="https://brand.example/offer" onChange={(e) => set("targetUrl", e.target.value)} />
            <label className="small">Opens</label>
            <div className="seg">{(["inapp", "external"] as const).map((m) => <button key={m} className={f.openMode === m ? "on" : ""} onClick={() => set("openMode", m)}>{m === "inapp" ? "In-app" : "Browser"}</button>)}</div>
          </>}

          <label className="small">Placements</label>
          <p className="am-group">🌐 Website</p>
          <div className="am-checks">{POS.map((p) => { const id = `site_${p.id}`; return <label key={id} className={`am-check ${f.placements.includes(id) ? "on" : ""}`}><input type="checkbox" checked={f.placements.includes(id)} onChange={() => toggleIn("placements", id)} />{p.label}</label>; })}</div>
          <p className="am-group">📱 Mini App</p>
          <div className="am-checks">{POS.map((p) => { const id = `app_${p.id}`; return <label key={id} className={`am-check ${f.placements.includes(id) ? "on" : ""}${f.kind === "html" ? " muted" : ""}`}><input type="checkbox" disabled={f.kind === "html"} checked={f.placements.includes(id)} onChange={() => toggleIn("placements", id)} />{p.label}</label>; })}</div>
          <label className="small">Screens (none = all)</label>
          <div className="chips">{PAGES.map((p) => <button key={p.id} className={`chip ${f.pages.includes(p.id) ? "on" : ""}`} onClick={() => toggleIn("pages", p.id)}>{p.label}</button>)}</div>
          <div className="sp-two">
            <div><label className="small">Start (optional)</label><input className="field" type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
            <div><label className="small">End (optional)</label><input className="field" type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
          </div>
          <div className="sp-two">
            <div><label className="small">Priority (0–100)</label><input className="field" type="number" min={0} max={100} value={f.priority} onChange={(e) => set("priority", Number(e.target.value))} /></div>
            <div><label className="small">Weight (rotation)</label><input className="field" type="number" min={1} max={100} value={f.weight} onChange={(e) => set("weight", Number(e.target.value))} /></div>
          </div>
          <label className="small">Interstitial frequency cap (per user per day, 0 = no cap)</label>
          <input className="field" type="number" min={0} max={50} value={f.freqCap} onChange={(e) => set("freqCap", Number(e.target.value))} />
          <div className="row sp-on"><b>Active</b><Toggle on={f.enabled} onChange={(v) => set("enabled", v)} label="Active" /></div>
          <label className="small">Preview</label>
          <Preview f={f} />
          {err && <p className="err">{err}</p>}
          <div className="sp-two"><button className="ghost" onClick={() => { setForm(null); setErr(""); }}>Cancel</button><button className="primary" disabled={saving || f.name.trim().length < 2 || !f.placements.length} onClick={save}>{saving ? "Saving…" : "Save"}</button></div>
        </div>
      )}
      {data && data.ads.length > 0 && <h3>All ads</h3>}
      {!data ? <div className="skel" /> : data.ads.length === 0 && !form ? <p className="small">No ads yet. Tap “＋ New ad”.</p> : data.ads.map((a) => {
        const thumb = a.images.default || a.images.infeed || a.images.top || a.images.sticky || a.images.interstitial || a.posterUrl;
        return (
          <div key={a.id} className="card rule sp-row">
            <div className="am-row">
              <div className="am-thumb">{thumb ? <img src={mediaSrc(thumb)} alt="" /> : a.kind === "video" && a.videoUrl ? <video src={mediaSrc(a.videoUrl)} muted /> : KINDS.find((k) => k.id === a.kind)?.icon}</div>
              <div>
                <div className="row"><b>{a.name}</b><Toggle on={a.enabled} onChange={(v) => toggle(a, v)} label="Active" /></div>
                <p className="small">{a.live ? "🟢 Live" : a.enabled ? "🕒 Scheduled / ended" : "⚪ Off"} · {KINDS.find((k) => k.id === a.kind)?.label} · P{a.priority} · W{a.weight}{a.startsAt ? ` · from ${ist(new Date(a.startsAt).toISOString())}` : ""}{a.endsAt ? ` · until ${ist(new Date(a.endsAt).toISOString())}` : ""}</p>
                <div className="am-tags">{a.placements.map((p) => <span key={p}>{placeLabel(p)}</span>)}{a.pages.length ? a.pages.map((p) => <span key={p}>{PAGES.find((x) => x.id === p)?.label}</span>) : <span>All screens</span>}</div>
                {a.targetUrl && <p className="small sp-url">{a.openMode === "inapp" ? "In-app" : "Browser"} → {a.targetUrl}</p>}
              </div>
            </div>
            <div className="am-stats"><span>Today <b>{a.stats.today.i}</b> imp · <b>{a.stats.today.c}</b> clk</span><span>7d <b>{a.stats.d7.i}</b> / <b>{a.stats.d7.c}</b></span><span>30d <b>{a.stats.d30.i}</b> / <b>{a.stats.d30.c}</b> · CTR {pct(a.stats.d30)}</span></div>
            <div className="sp-two"><button className="ghost" onClick={() => edit(a)}>Edit</button><button className="ghost danger" onClick={() => remove(a)}>Delete</button></div>
          </div>
        );
      })}
    </div>
  );
}

/** Reports: per-ad impressions / clicks + CSV. */
export type AdUnitReportRow = { id: string; name: string; kind: string; enabled: boolean; impressions: number; clicks: number; ctr: number; site: Stat; app: Stat };
export function AdUnitsTable({ rows, days }: { rows?: AdUnitReportRow[]; days: number }) {
  if (!rows) return null;
  async function csv() {
    haptic("light");
    const res = await fetch(`${apiBase()}/api/admin/adunits/report.csv?days=${days}`, { headers: { authorization: `tma ${initData()}` } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `liveline-ads-${days}d.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  return (
    <div>
      <div className="row"><h3>🖼 Ads — impressions & clicks</h3><button className="chip on" onClick={csv}>CSV</button></div>
      {rows.length === 0 ? <p className="small">No ad activity in this window.</p> : (
        <div className="table-wrap">
          <table className="attr">
            <thead><tr><th>Ad</th><th>Impr.</th><th>Clicks</th><th>CTR</th><th>🌐 / 📱</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{r.name}{r.enabled ? " 🟢" : ""}</td><td>{r.impressions}</td><td>{r.clicks}</td><td>{r.ctr}%</td><td>{r.site.i}/{r.site.c} · {r.app.i}/{r.app.c}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
