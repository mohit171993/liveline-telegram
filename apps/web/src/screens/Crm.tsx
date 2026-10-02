import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, haptic, toast } from "../lib";
import { Empty } from "../ui";
import { SponsorTapsTable } from "./Sponsor";

/* ---------------------------------------------------------------- shared bits */

const ADMIN_TABS = [
  { to: "/admin", label: "📊 Dashboard" },
  { to: "/admin/crm", label: "📇 CRM" },
  { to: "/admin/broadcasts", label: "📣 Broadcast" },
  { to: "/admin/automation", label: "⚙️ Automations" },
  { to: "/admin/channel", label: "📢 Channel" },
  { to: "/admin/sponsors", label: "💚 Sponsors" },
  { to: "/admin/funnel", label: "🧭 Funnel" },
  { to: "/admin/settings", label: "🔔 Alerts" },
  { to: "/admin/reports", label: "📈 Reports" },
  { to: "/admin/admins", label: "🛡 Admins" },
];

export function AdminNav() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const active = (to: string) => (to === "/admin" ? pathname === "/admin" : pathname.startsWith(to));
  return (
    <div className="admin-nav" role="tablist">
      {ADMIN_TABS.map((tab) => (
        <button key={tab.to} role="tab" className={`chip ${active(tab.to) ? "on" : ""}`} onClick={() => { haptic("light"); nav(tab.to); }}>{tab.label}</button>
      ))}
    </div>
  );
}

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
export function ist(iso?: string | null) {
  return iso ? `${IST.format(new Date(iso))} IST` : "—";
}
function ago(iso?: string | null) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" className={`toggle ${on ? "on" : ""}`} aria-pressed={on} aria-label={label} onClick={() => { haptic("light"); onChange(!on); }}>
      <span />
    </button>
  );
}

async function exportCsv(kind: "users" | "attribution", body: Record<string, unknown>) {
  try {
    const { url, fileName } = await api<{ url: string; fileName: string }>("/api/admin/crm/export", { method: "POST", body: JSON.stringify({ kind, ...body }) });
    const tg = (window.Telegram?.WebApp || {}) as { downloadFile?: (p: { url: string; file_name: string }, cb?: (ok: boolean) => void) => void; openLink?: (u: string) => void };
    if (tg.downloadFile) {
      tg.downloadFile({ url, file_name: fileName });
      toast("CSV ready. Confirm the download in Telegram.");
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("CSV downloading");
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : "Export failed", "err");
  }
}

type Filter = {
  q?: string; verified?: string; source?: string; language?: string; joinedFrom?: string; joinedTo?: string;
  activeWithinDays?: number | string; inactiveDays?: number | string; minPoints?: number | string; predicted?: string; tag?: string; sort?: string;
};

function clean(f: Filter): Filter {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "" && v !== "any") out[k] = v;
  return out as Filter;
}

/* ---------------------------------------------------------------- CRM users */

export function CrmUsers() {
  const nav = useNavigate();
  const [f, setF] = useState<Filter>(() => {
    try { return JSON.parse(sessionStorage.getItem("ll:crm:f") || "{}"); } catch { return {}; }
  });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<any>(null);
  const [opts, setOpts] = useState<any>(null);
  const [segs, setSegs] = useState<any[]>([]);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const filter = useMemo(() => clean(f), [f]);

  useEffect(() => { api("/api/admin/crm/options").then(setOpts).catch(() => undefined); loadSegs(); }, []);
  useEffect(() => {
    sessionStorage.setItem("ll:crm:f", JSON.stringify(f));
    const id = setTimeout(() => {
      api(`/api/admin/crm/users?page=${page}&filter=${encodeURIComponent(JSON.stringify(filter))}`).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(id);
  }, [filter, page]);

  function loadSegs() { api<{ segments: any[] }>("/api/admin/crm/segments").then((d) => setSegs(d.segments)).catch(() => undefined); }
  const set = (patch: Filter) => { setPage(0); setF((cur) => ({ ...cur, ...patch })); };

  async function saveSegment() {
    const name = window.prompt("Name this segment (e.g. 'Verified, inactive 7d')");
    if (!name) return;
    try {
      await api("/api/admin/crm/segments", { method: "POST", body: JSON.stringify({ name, filter }) });
      toast(`Segment “${name}” saved`);
      loadSegs();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save", "err"); }
  }

  async function bulkTag() {
    const tag = window.prompt(`Tag all ${data?.total ?? 0} users in this view with:`);
    if (!tag) return;
    try {
      const r = await api<{ count: number; tag: string }>("/api/admin/crm/bulk-tag", { method: "POST", body: JSON.stringify({ tag, filter }) });
      toast(`Tagged ${r.count} users #${r.tag}`);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not tag", "err"); }
  }

  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>CRM · Users</h2><span className="small">{data ? `${data.total} match` : "…"}</span></div>
      <input className="field" placeholder="🔎 Search name, @handle or Telegram ID" value={f.q || ""} onChange={(e) => set({ q: e.target.value })} />
      <div className="chips">
        {[["any", "All"], ["yes", "✅ Verified"], ["no", "⏳ Unverified"]].map(([v, l]) => (
          <button key={v} className={`chip ${(f.verified || "any") === v ? "on" : ""}`} onClick={() => set({ verified: v })}>{l}</button>
        ))}
        <button className={`chip ${f.activeWithinDays === 1 ? "on" : ""}`} onClick={() => set({ activeWithinDays: f.activeWithinDays === 1 ? "" : 1, inactiveDays: "" })}>Active today</button>
        <button className={`chip ${f.inactiveDays === 7 ? "on" : ""}`} onClick={() => set({ inactiveDays: f.inactiveDays === 7 ? "" : 7, activeWithinDays: "" })}>Inactive 7d+</button>
        <button className={`chip ${more ? "on" : ""}`} onClick={() => setMore(!more)}>⚙️ More filters</button>
      </div>
      {more && (
        <div className="card filters">
          <label>Source (startapp / ad tag)
            <select className="field" value={f.source || ""} onChange={(e) => set({ source: e.target.value })}>
              <option value="">Any source</option>
              {(opts?.sources || []).map((s: any) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
            </select>
          </label>
          <label>Language
            <select className="field" value={f.language || ""} onChange={(e) => set({ language: e.target.value })}>
              <option value="">Any</option>
              {(opts?.languages || []).map((s: any) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
            </select>
          </label>
          <div className="two">
            <label>Joined from<input className="field" type="date" value={f.joinedFrom || ""} onChange={(e) => set({ joinedFrom: e.target.value })} /></label>
            <label>Joined to<input className="field" type="date" value={f.joinedTo || ""} onChange={(e) => set({ joinedTo: e.target.value })} /></label>
          </div>
          <div className="two">
            <label>Active within (days)<input className="field" inputMode="numeric" value={f.activeWithinDays ?? ""} onChange={(e) => set({ activeWithinDays: e.target.value })} /></label>
            <label>Inactive for (days)<input className="field" inputMode="numeric" value={f.inactiveDays ?? ""} onChange={(e) => set({ inactiveDays: e.target.value })} /></label>
          </div>
          <div className="two">
            <label>Min points<input className="field" inputMode="numeric" value={f.minPoints ?? ""} onChange={(e) => set({ minPoints: e.target.value })} /></label>
            <label>Predicted
              <select className="field" value={f.predicted || ""} onChange={(e) => set({ predicted: e.target.value })}>
                <option value="">Any</option><option value="yes">Has predicted</option><option value="no">Never predicted</option>
              </select>
            </label>
          </div>
          <div className="two">
            <label>Tag
              <select className="field" value={f.tag || ""} onChange={(e) => set({ tag: e.target.value })}>
                <option value="">Any</option>
                {(opts?.tags || []).map((s: any) => <option key={s.value} value={s.value}>#{s.value} ({s.count})</option>)}
              </select>
            </label>
            <label>Sort
              <select className="field" value={f.sort || "joined"} onChange={(e) => set({ sort: e.target.value })}>
                <option value="joined">Newest</option><option value="active">Last active</option><option value="points">Points</option>
              </select>
            </label>
          </div>
          <button className="ghost w-full" onClick={() => { setF({}); setPage(0); toast("Filters cleared"); }}>Clear filters</button>
        </div>
      )}
      {segs.length > 0 && (
        <div className="chips">
          <span className="small">Segments:</span>
          {segs.map((s) => (
            <button key={s.id} className="chip" onClick={() => { setF(s.filter); setPage(0); toast(`Segment: ${s.name}`); }}>{s.name} · {s.count}</button>
          ))}
        </div>
      )}
      <div className="actions-row">
        <button className="ghost" onClick={() => exportCsv("users", { filter })}>⬇️ CSV</button>
        <button className="ghost" onClick={saveSegment}>💾 Save segment</button>
        <button className="ghost" onClick={bulkTag}>🏷 Tag all</button>
        <button className="ghost" onClick={() => { sessionStorage.setItem("ll:bc:filter", JSON.stringify(filter)); nav("/admin/broadcasts?new=1"); }}>📣 Message</button>
      </div>
      {err && <p className="small err">{err}</p>}
      {!data && !err && <><div className="skel" /><div className="skel" /></>}
      {data && data.users.length === 0 && <Empty icon="🔎" title="No users match" text="Loosen a filter or clear them." cta="Clear filters" onCta={() => setF({})} />}
      {data?.users.map((u: any) => (
        <button key={u.id} className="crm-row" onClick={() => nav(`/admin/crm/user/${u.id}`)}>
          <div className="crm-ava">{(u.name || u.username || "?").slice(0, 1).toUpperCase()}</div>
          <div className="crm-main">
            <b>{u.name || "—"} {u.username && <span className="small">@{u.username}</span>}</b>
            <span className="small">
              {u.verified ? "✅" : "⏳"} {u.source || "direct"} · {u.language} · joined {ago(u.joinedAt)} · seen {ago(u.lastSeenAt)}
            </span>
            {(u.tags.length > 0 || u.optOut || u.botBlocked) && (
              <span className="crm-tags">
                {u.optOut && <i className="tag warn">🔕 /stop</i>}
                {u.botBlocked && <i className="tag warn">⛔ blocked bot</i>}
                {u.tags.map((t: string) => <i key={t} className="tag">#{t}</i>)}
              </span>
            )}
          </div>
          <div className="crm-pts"><b>{u.points}</b><span className="small">pts · {u.predictions}🎯</span></div>
        </button>
      ))}
      {data && data.total > 50 && (
        <div className="actions-row">
          <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="small">Page {page + 1} / {Math.ceil(data.total / 50)}</span>
          <button className="ghost" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- CRM profile */

export function CrmUser() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const load = () => api(`/api/admin/crm/users/${id}`).then(setP).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <div className="admin"><AdminNav /><Empty icon="👤" title="User not found" text={err} cta="Back to CRM" onCta={() => nav("/admin/crm")} /></div>;
  if (!p) return <div className="admin"><AdminNav /><div className="skel" /><div className="skel" /></div>;
  const u = p.user;
  async function addTag() {
    if (!tag.trim()) return;
    try { await api(`/api/admin/crm/users/${u.id}/tags`, { method: "POST", body: JSON.stringify({ tag }) }); setTag(""); toast("Tag added"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  async function dropTag(t: string) {
    await api(`/api/admin/crm/users/${u.id}/tags`, { method: "POST", body: JSON.stringify({ tag: t, remove: true }) }).catch(() => undefined);
    toast(`Removed #${t}`); load();
  }
  async function addNote() {
    if (!note.trim()) return;
    try { await api(`/api/admin/crm/users/${u.id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) }); setNote(""); toast("Note saved"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  return (
    <div className="admin">
      <AdminNav />
      <button className="chip" onClick={() => nav(-1)}>← Back</button>
      <div className="card profile-card">
        <div className="crm-ava big">{(u.name || u.username || "?").slice(0, 1).toUpperCase()}</div>
        <div>
          <h2>{u.name || "—"}</h2>
          <p className="small">{u.username ? `@${u.username} · ` : ""}ID {u.telegramId}</p>
          <p className="small">{u.verified ? `✅ Verified ${ist(u.verifiedAt)}` : "⏳ Not verified"} · {u.status}{u.premium ? " · ⭐ Premium" : ""}</p>
          <p className="small">📱 {u.phone} · 🌐 {u.language} · 🧭 {u.source || "direct"} ({u.bucket})</p>
          <p className="small">Joined {ist(u.joinedAt)} · Last seen {ist(u.lastSeenAt)}</p>
          {(u.optOut || u.botBlocked || u.banned) && <p className="small warn">{u.optOut ? "🔕 Opted out (/stop) " : ""}{u.botBlocked ? "⛔ Blocked the bot " : ""}{u.banned ? "🚫 Banned" : ""}</p>}
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><span className="small">Points</span><b>{u.points}</b></div>
        <div className="kpi"><span className="small">Predictions</span><b>{p.stats.predictions}</b></div>
        <div className="kpi"><span className="small">Accuracy</span><b>{p.stats.accuracy}%</b></div>
      </div>
      <h3>Tags & segments</h3>
      <div className="chips">
        {p.tags.length === 0 && <span className="small">No tags yet</span>}
        {p.tags.map((t: string) => <button key={t} className="chip on" onClick={() => dropTag(t)}>#{t} ✕</button>)}
      </div>
      <div className="inline-form">
        <input className="field" placeholder="Add tag (vip, influencer, ad-lino…)" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} />
        <button className="ghost" onClick={addTag}>Add</button>
      </div>
      <h3>Notes</h3>
      <div className="inline-form">
        <input className="field" placeholder="Private admin note" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
        <button className="ghost" onClick={addNote}>Save</button>
      </div>
      {p.notes.map((n: any) => <div key={n.id} className="note"><b>{n.by || "admin"}</b> <span className="small">{ist(n.at)}</span><p>{n.body}</p></div>)}
      <h3>Activity timeline</h3>
      {p.timeline.length === 0 && <Empty icon="🕒" title="No activity yet" text="Events show up as the user plays." />}
      <div className="timeline">
        {p.timeline.map((e: any, i: number) => (
          <div key={i} className={`tl tl-${e.kind}`}><span className="dot" /><div><b>{e.text}</b><span className="small">{ist(e.at)}</span></div></div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Broadcasts */

const TARGETS = [["home", "🏠 Home"], ["live", "🏏 Live"], ["predict", "🎯 Predict"], ["spin", "🎡 Spin"], ["board", "🏆 Leaderboard"], ["alerts", "🔔 Reminders"], ["lino", "🤖 Lino"], ["play", "🎮 Play"], ["pass", "🎟 Pass"]];

export function Broadcasts() {
  const loc = useLocation();
  const [list, setList] = useState<any[] | null>(null);
  const [segs, setSegs] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(() => (new URLSearchParams(loc.search).get("new") ? blank() : null));
  const load = () => api<{ broadcasts: any[] }>("/api/admin/crm/broadcasts").then((d) => setList(d.broadcasts)).catch(() => setList([]));
  useEffect(() => {
    load();
    api<{ segments: any[] }>("/api/admin/crm/segments").then((d) => setSegs(d.segments)).catch(() => undefined);
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);
  function blank() {
    let filter = { verified: "yes" };
    try { filter = { ...filter, ...JSON.parse(sessionStorage.getItem("ll:bc:filter") || "{}") }; } catch { /* keep */ }
    sessionStorage.removeItem("ll:bc:filter");
    return { text: "", buttonText: "🏏 Open LiveLine", buttonParam: "live", filter, scheduledAt: "" };
  }
  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>Broadcasts</h2><button className="chip on" onClick={() => setEditing(blank())}>＋ New</button></div>
      <p className="small">Draft → preview → test to yourself → confirm. Nothing sends without your ✅. Delivery is rate-limited (~20/s) and skips users who sent /stop or blocked the bot.</p>
      {editing && <Composer draft={editing} segments={segs} onClose={() => { setEditing(null); load(); }} />}
      {list && list.length === 0 && !editing && <Empty icon="📣" title="No broadcasts yet" text="Message a segment of your users through the bot." cta="＋ New broadcast" onCta={() => setEditing(blank())} />}
      {!list && <div className="skel" />}
      {list?.map((b) => (
        <div key={b.id} className="card bc-card">
          <div className="row"><span className={`pill st-${b.status}`}>{b.status}</span><span className="small">{ist(b.createdAt)}</span></div>
          <p className="bc-text">{b.text.slice(0, 180)}{b.text.length > 180 ? "…" : ""}</p>
          <div className="bc-stats">
            <span><b>{b.total}</b> audience</span><span><b>{b.sent}</b> delivered</span><span><b>{b.opened}</b> opened ({b.openRate}%)</span>
            <span><b>{b.blocked}</b> blocked</span><span><b>{b.failed}</b> failed</span>
          </div>
          {b.total > 0 && <div className="bar"><i style={{ width: `${Math.min(100, Math.round(((b.sent + b.failed + b.blocked) / b.total) * 100))}%` }} /></div>}
          <p className="small">{b.segmentName ? `Segment: ${b.segmentName} · ` : ""}{b.scheduledAt ? `Scheduled ${ist(b.scheduledAt)}` : ""}{b.finishedAt ? ` · Finished ${ist(b.finishedAt)}` : ""}</p>
          <div className="actions-row">
            {b.status === "draft" && <button className="ghost" onClick={() => setEditing(b)}>✏️ Edit / send</button>}
            {(b.status === "scheduled" || b.status === "sending" || b.status === "draft") && (
              <button className="ghost danger" onClick={async () => { await api(`/api/admin/crm/broadcasts/${b.id}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined); toast("Cancelled"); load(); }}>✖️ Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Composer({ draft, segments, onClose }: { draft: any; segments: any[]; onClose: () => void }) {
  const [d, setD] = useState<any>({ ...draft, scheduledAt: draft.scheduledAt ? toLocalInput(draft.scheduledAt) : "" });
  const [aud, setAud] = useState<{ count: number; excluded: number } | null>(null);
  const [saved, setSaved] = useState<any>(draft.id ? draft : null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => api("/api/admin/crm/audience", { method: "POST", body: JSON.stringify({ filter: d.filter }) }).then(setAud).catch(() => undefined), 300);
    return () => clearTimeout(id);
  }, [JSON.stringify(d.filter)]);
  const body = () => JSON.stringify({ text: d.text, buttonText: d.buttonText || null, buttonParam: d.buttonParam, filter: d.filter, segmentName: d.segmentName || null, scheduledAt: d.scheduledAt ? new Date(d.scheduledAt).toISOString() : null });
  async function save() {
    setBusy(true);
    try {
      const b = saved ? await api(`/api/admin/crm/broadcasts/${saved.id}`, { method: "POST", body: body() }) : await api("/api/admin/crm/broadcasts", { method: "POST", body: body() });
      setSaved(b);
      toast("Draft saved");
      return b;
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save", "err"); return null; } finally { setBusy(false); }
  }
  async function test() {
    const b = await save();
    if (!b) return;
    try { await api(`/api/admin/crm/broadcasts/${b.id}/test`, { method: "POST", body: "{}" }); toast("Test sent to your Telegram DM 📬"); } catch (e) { toast(e instanceof Error ? e.message : "Test failed", "err"); }
  }
  async function confirm() {
    const b = await save();
    if (!b) return;
    try {
      await api(`/api/admin/crm/broadcasts/${b.id}/confirm`, { method: "POST", body: JSON.stringify({ confirm: true, expectTotal: b.total }) });
      toast(d.scheduledAt ? `Scheduled for ${b.total} users` : `Sending to ${b.total} users`);
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not confirm", "err"); setConfirming(false); }
  }
  const setFilter = (patch: object) => setD({ ...d, filter: { ...d.filter, ...patch }, segmentName: "" });
  return (
    <div className="card composer">
      <div className="row"><h3>{saved ? "Edit draft" : "New broadcast"}</h3><button className="chip" onClick={onClose}>✕</button></div>
      <label>Audience</label>
      <div className="chips">
        {[["yes", "✅ Verified"], ["no", "⏳ Unverified"], ["any", "Everyone"]].map(([v, l]) => (
          <button key={v} className={`chip ${(d.filter?.verified || "yes") === v ? "on" : ""}`} onClick={() => setFilter({ verified: v })}>{l}</button>
        ))}
        {segments.map((s) => <button key={s.id} className={`chip ${d.segmentName === s.name ? "on" : ""}`} onClick={() => setD({ ...d, filter: s.filter, segmentName: s.name })}>{s.name}</button>)}
      </div>
      <p className="small">{aud ? <>👥 <b>{aud.count}</b> reachable users{aud.excluded ? ` · ${aud.excluded} skipped (/stop or blocked)` : ""}</> : "Counting…"}</p>
      <label>Message <span className="small">(&lt;b&gt; &lt;i&gt; &lt;u&gt; allowed · no betting/odds)</span></label>
      <textarea className="area" rows={5} maxLength={3500} placeholder="🏏 India vs Australia is LIVE! Free predictions are open…" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} />
      <div className="two">
        <label>Button text<input className="field" maxLength={40} value={d.buttonText || ""} placeholder="(no button)" onChange={(e) => setD({ ...d, buttonText: e.target.value })} /></label>
        <label>Opens
          <select className="field" value={d.buttonParam || "home"} onChange={(e) => setD({ ...d, buttonParam: e.target.value })}>
            {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <label>Schedule (your local time, optional)<input className="field" type="datetime-local" value={d.scheduledAt || ""} onChange={(e) => setD({ ...d, scheduledAt: e.target.value })} /></label>
      <label>Preview</label>
      <div className="tg-preview">
        <div className="tg-bubble" dangerouslySetInnerHTML={{ __html: previewHtml(d.text) || "<i>Your message…</i>" }} />
        {d.buttonText && <div className="tg-btn">{d.buttonText}</div>}
      </div>
      <div className="actions-row">
        <button className="ghost" disabled={busy} onClick={save}>💾 Save draft</button>
        <button className="ghost" disabled={busy || !d.text.trim()} onClick={test}>🧪 Test to me</button>
      </div>
      {!confirming ? (
        <button className="primary" disabled={busy || !d.text.trim() || !aud?.count} onClick={() => { haptic("medium"); setConfirming(true); }}>
          📣 Review & send to {aud?.count ?? "…"}
        </button>
      ) : (
        <div className="confirm-box">
          <p><b>Send this to {aud?.count} users{d.scheduledAt ? ` at ${new Date(d.scheduledAt).toLocaleString()}` : " now"}?</b><br /><span className="small">This can't be unsent. You can cancel while it's still sending.</span></p>
          <div className="actions-row">
            <button className="ghost" onClick={() => setConfirming(false)}>Back</button>
            <button className="primary" disabled={busy} onClick={confirm}>✅ Confirm send</button>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function previewHtml(text: string) {
  return (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&lt;(\/?)(b|i|u|s|code)&gt;/g, "<$1$2>").replace(/\n/g, "<br/>");
}

/* ---------------------------------------------------------------- Automations */

export function Automation() {
  const [s, setS] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api("/api/admin/automation").then(setS).catch((e) => setS({ error: e.message }));
  useEffect(() => { load(); }, []);
  async function patch(body: object, msg: string) {
    try { setS(await api("/api/admin/automation", { method: "POST", body: JSON.stringify(body) })); toast(msg); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  if (!s) return <div className="admin"><AdminNav /><div className="skel" /><div className="skel" /></div>;
  if (s.error) return <div className="admin"><AdminNav /><Empty icon="⚙️" title="Couldn't load automations" text={s.error} cta="Retry" onCta={load} /></div>;
  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>Automations</h2><Toggle on={s.enabled} label="All automations" onChange={(v) => patch({ masterEnabled: v }, v ? "Automations on" : "All automations paused")} /></div>
      <div className="card">
        <div className="two">
          <label>Max per user / day<input className="field" inputMode="numeric" defaultValue={s.global.maxPerDay} onBlur={(e) => patch({ global: { maxPerDay: Number(e.target.value) } }, "Daily cap saved")} /></label>
          <label>Quiet hours (IST)
            <span className="two">
              <input className="field" inputMode="numeric" defaultValue={s.global.quietStart} onBlur={(e) => patch({ global: { quietStart: Number(e.target.value) } }, "Quiet hours saved")} />
              <input className="field" inputMode="numeric" defaultValue={s.global.quietEnd} onBlur={(e) => patch({ global: { quietEnd: Number(e.target.value) } }, "Quiet hours saved")} />
            </span>
          </label>
        </div>
        <p className="small">{s.quietNow ? "🌙 Quiet hours right now: nothing sends until they end." : "☀️ Sending window open."} · 🔕 {s.optedOut} opted out (/stop) · ⛔ {s.blocked} blocked the bot (auto-skipped)</p>
      </div>
      {s.rules.map((r: any) => (
        <div key={r.key} className={`card rule ${r.enabled ? "" : "off"}`}>
          <div className="row">
            <div><b>{r.title}</b><p className="small">{r.about}</p></div>
            <Toggle on={r.enabled} label={r.title} onChange={(v) => patch({ key: r.key, enabled: v }, `${r.title}: ${v ? "on" : "off"}`)} />
          </div>
          <div className="bc-stats">
            <span><b>{r.stats.today}</b> today</span><span><b>{r.stats.sent7d}</b> sent 7d</span><span><b>{r.stats.opened7d}</b> opened ({r.stats.openRate}%)</span>
            <span><b>{r.stats.blocked7d}</b> blocked</span>
            {r.key === "verify_nudge" && <span><b>{r.stats.converted7d}</b>/{r.stats.nudged7d} verified ({r.stats.conversion}%)</span>}
          </div>
          <button className="ghost w-full" onClick={() => setOpen(open === r.key ? null : r.key)}>{open === r.key ? "Close" : "✏️ Timing, text & preview"}</button>
          {open === r.key && <RuleEditor rule={r} buttons={s.buttons} onSave={(config) => patch({ key: r.key, config }, "Saved")} />}
        </div>
      ))}
    </div>
  );
}

function RuleEditor({ rule, buttons, onSave }: { rule: any; buttons: string[]; onSave: (c: object) => void }) {
  const [c, setC] = useState<any>(rule.config);
  const [step, setStep] = useState(0);
  const [pv, setPv] = useState<any>(null);
  const texts: string[] = Array.isArray(c.texts) ? c.texts : [c.text];
  useEffect(() => { api(`/api/admin/automation/${rule.key}/preview?step=${step}`).then(setPv).catch(() => undefined); }, [step, rule.config]);
  const setText = (i: number, v: string) => (Array.isArray(c.texts) ? setC({ ...c, texts: c.texts.map((t: string, j: number) => (j === i ? v : t)) }) : setC({ ...c, text: v }));
  return (
    <div className="rule-edit">
      {rule.key === "verify_nudge" && (
        <label>Send after (hours since /start, max 3)
          <input className="field" value={(c.delaysH || []).join(", ")} onChange={(e) => setC({ ...c, delaysH: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} />
        </label>
      )}
      {rule.key === "winback" && (
        <label>Inactive days (one message each)
          <input className="field" value={(c.days || []).join(", ")} onChange={(e) => setC({ ...c, days: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} />
        </label>
      )}
      {rule.key === "match_start" && (
        <div className="two">
          <label>Minutes before start<input className="field" inputMode="numeric" value={c.leadMin} onChange={(e) => setC({ ...c, leadMin: Number(e.target.value) })} /></label>
          <label>Big matches → all active<span className="row"><Toggle on={c.bigMatches} onChange={(v) => setC({ ...c, bigMatches: v })} /></span></label>
        </div>
      )}
      {(rule.key === "daily_predict" || rule.key === "daily_spin") && (
        <label>Send at (IST hour, 8–21)<input className="field" inputMode="numeric" value={c.hourIst} onChange={(e) => setC({ ...c, hourIst: Number(e.target.value) })} /></label>
      )}
      {rule.key !== "verify_nudge" && (
        <label>Button opens
          <select className="field" value={c.button} onChange={(e) => setC({ ...c, button: e.target.value })}>{buttons.map((b) => <option key={b} value={b}>{b}</option>)}</select>
        </label>
      )}
      {texts.map((t, i) => (
        <label key={i}>{texts.length > 1 ? `Message ${i + 1}` : "Message"} <span className="small">{"{name} {match} {time} {matches} {points}"}</span>
          <textarea className="area" rows={4} value={t} onFocus={() => setStep(i)} onChange={(e) => setText(i, e.target.value)} />
        </label>
      ))}
      <label>Preview {texts.length > 1 && `(message ${step + 1})`} · saved copy</label>
      <div className="tg-preview">
        <div className="tg-bubble" dangerouslySetInnerHTML={{ __html: (pv?.html || "").replace(/\n/g, "<br/>") }} />
        {pv && <div className={`tg-btn ${pv.buttonKind === "reply_keyboard" ? "reply" : ""}`}>{pv.button}</div>}
      </div>
      <div className="actions-row">
        <button className="primary" onClick={() => onSave(c)}>💾 Save</button>
        <button className="ghost" onClick={async () => { try { await api(`/api/admin/automation/${rule.key}/test`, { method: "POST", body: JSON.stringify({ step }) }); toast("Test sent to your DM 📬"); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); } }}>🧪 Test to me</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Channel */

export function ChannelAdmin() {
  const [s, setS] = useState<any>(null);
  const load = () => api("/api/admin/channel").then(setS).catch((e) => setS({ error: e.message }));
  useEffect(() => { load(); }, []);
  async function patch(body: object, msg: string) {
    try { await api("/api/admin/channel", { method: "POST", body: JSON.stringify(body) }); toast(msg); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  if (!s) return <div className="admin"><AdminNav /><div className="skel" /></div>;
  if (s.error) return <div className="admin"><AdminNav /><Empty icon="📢" title="Couldn't load" text={s.error} cta="Retry" onCta={load} /></div>;
  const c = s.config;
  const types: [string, string][] = [["startingSoon", "⏰ Match starting soon (toss + XI)"], ["moments", "☝️ Key moments (wickets, 50s, 100s)"], ["innings", "☕ Innings break"], ["result", "🏆 Result"], ["daily", "📅 Daily today's matches"]];
  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>Channel auto-post</h2><Toggle on={s.enabled} label="Channel auto-post" onChange={(v) => patch({ enabled: v }, v ? "Auto-post on" : "Auto-post paused")} /></div>
      <p className="small">{s.live ? "🟢 LIVE: posting branded cards to the channel for real matches." : s.envOn ? "⏸ Paused here." : "⚪ Off at deploy level (CHANNEL_AUTOPOST)."} Channel: {s.channelId || "not set"}</p>
      <div className="card">
        {types.map(([k, l]) => (
          <div key={k} className="row sheet-row"><span>{l}</span><Toggle on={c[k]} onChange={(v) => patch({ config: { [k]: v } }, "Saved")} /></div>
        ))}
        <div className="two">
          <label>Key-moment gap (min)<input className="field" inputMode="numeric" defaultValue={c.momentGapMin} onBlur={(e) => patch({ config: { momentGapMin: Number(e.target.value) } }, "Saved")} /></label>
          <label>Daily card at (IST hour)<input className="field" inputMode="numeric" defaultValue={c.dailyHourIst} onBlur={(e) => patch({ config: { dailyHourIst: Number(e.target.value) } }, "Saved")} /></label>
        </div>
      </div>
      <h3>Send a test card to my DM</h3>
      <div className="chips">
        {[["start", "Starting soon"], ["moment", "Wicket"], ["innings", "Innings break"], ["result", "Result"], ["today", "Today's matches"]].map(([k, l]) => (
          <button key={k} className="chip" onClick={async () => { try { await api("/api/admin/channel/test", { method: "POST", body: JSON.stringify({ kind: k }) }); toast("Test card sent to your DM 📬"); load(); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); } }}>{l}</button>
        ))}
      </div>
      <h3>Last 7 days</h3>
      {s.stats.length === 0 ? <p className="small">No channel posts yet.</p> : <div className="bc-stats">{s.stats.map((x: any) => <span key={x.kind}><b>{x.count}</b> {x.kind}</span>)}</div>}
      <h3>Recent activity</h3>
      {s.log.length === 0 && <p className="small">Nothing posted yet. Cards go out only for real live/upcoming matches.</p>}
      {s.log.map((l: any, i: number) => <div key={i} className="board"><span>{l.ok ? "✅" : "⚠️"} {l.kind} · {l.target}{l.matchKey ? ` · ${l.matchKey.slice(-12)}` : ""}</span><span className="small">{ago(new Date(l.at).toISOString())}</span></div>)}
    </div>
  );
}

/* ---------------------------------------------------------------- Funnel & attribution */

export function Funnel() {
  const [days, setDays] = useState(30);
  const [f, setF] = useState<any>(null);
  const [a, setA] = useState<any>(null);
  useEffect(() => {
    setF(null); setA(null);
    api(`/api/admin/crm/funnel?days=${days}`).then(setF).catch(() => setF({ steps: [] }));
    api(`/api/admin/crm/attribution?days=${days}`).then(setA).catch(() => setA({ rows: [] }));
  }, [days]);
  return (
    <div className="admin">
      <AdminNav />
      <div className="page-head"><h2>Funnel</h2>
        <div className="seg">{[7, 30, 90].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d}d</button>)}</div>
      </div>
      {!f ? <div className="skel" /> : (
        <div className="funnel">
          {f.steps.map((s: any, i: number) => (
            <div key={s.key} className="funnel-step">
              <div className="row"><b>{s.label}</b><span><b>{s.count}</b> <span className="small">{s.pct}%{i > 0 ? ` · ${s.step}% of prev` : ""}</span></span></div>
              <div className="bar"><i style={{ width: `${Math.max(2, s.pct)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      <div className="page-head"><h3>Ad-source attribution</h3><button className="chip" onClick={() => exportCsv("attribution", { days })}>⬇️ CSV</button></div>
      <p className="small">Source = the startapp / start tag users arrived with (e.g. t.me/LiveLineProBot?start=ad_insta1).</p>
      {!a ? <div className="skel" /> : a.rows.length === 0 ? <Empty icon="🧭" title="No new users in this window" text="Attribution fills in as people join." /> : (
        <div className="table-wrap">
          <table className="attr">
            <thead><tr><th>Source</th><th>Start</th><th>Verify</th><th>Predict</th><th>Return</th></tr></thead>
            <tbody>
              {a.rows.map((r: any) => (
                <tr key={r.source}><td>{r.source}</td><td>{r.started}</td><td>{r.verified} <i>{r.verifyRate}%</i></td><td>{r.predicted} <i>{r.predictRate}%</i></td><td>{r.returned} <i>{r.returnRate}%</i></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SponsorTapsTable rows={a?.sponsors} />
    </div>
  );
}

/* ---------------------------------------------------------------- Alert settings */

export function AdminSettings() {
  const [s, setS] = useState<any>(null);
  useEffect(() => { api("/api/admin/alerts").then(setS).catch(() => setS({})); }, []);
  async function set(key: string, enabled: boolean) {
    try { setS(await api("/api/admin/alerts", { method: "POST", body: JSON.stringify({ key, enabled }) })); toast(enabled ? "Alert on" : "Alert off"); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  async function test(kind: string) {
    try { await api("/api/admin/alerts/test", { method: "POST", body: JSON.stringify({ kind }) }); toast("Sample alert sent to your DM 📬"); } catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }
  if (!s) return <div className="admin"><AdminNav /><div className="skel" /></div>;
  return (
    <div className="admin">
      <AdminNav />
      <h2>Admin alerts</h2>
      <p className="small">Sent by the bot to every admin. Phone numbers are always masked.</p>
      <div className="card rule">
        <div className="row"><div><b>🆕 New start</b><p className="small">Someone pressed Start for the first time (not verified yet).</p></div><Toggle on={!!s.alert_new_start} onChange={(v) => set("alert_new_start", v)} /></div>
        <button className="ghost w-full" onClick={() => test("start")}>🧪 Send me a sample</button>
      </div>
      <div className="card rule">
        <div className="row"><div><b>✅ New verified user</b><p className="small">Phone verification completed: ID, handle, name, language, masked phone, Premium, source, time, total verified.</p></div><Toggle on={!!s.alert_verified} onChange={(v) => set("alert_verified", v)} /></div>
        <button className="ghost w-full" onClick={() => test("verified")}>🧪 Send me a sample</button>
      </div>
    </div>
  );
}
