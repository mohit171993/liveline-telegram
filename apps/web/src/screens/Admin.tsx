import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, toast } from "../lib";
import { Empty } from "../ui";
import { AdminNav } from "./Crm";

export function Dash() {
  const [data, setData] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => { api("/api/admin/overview").then(setData).catch(() => setData({ error: true })); }, []);
  if (!data) return <div className="admin"><AdminNav /><div className="skel" /></div>;
  if (data.error) return <div className="admin"><AdminNav /><Empty icon="🛠" title="Admin only" text="This account isn't on the admin list." /></div>;
  return (
    <div className="admin">
      <AdminNav />
      <h2>Dashboard</h2>
      <div className="kpis">
        <div className="kpi"><span className="small">Users</span><b>{data.active}</b></div>
        <div className="kpi"><span className="small">DAU</span><b>{data.dau}</b></div>
        <div className="kpi"><span className="small">New</span><b>{data.newToday}</b></div>
      </div>
      <div className="kpis">
        <div className="kpi"><span className="small">Impr</span><b>{data.impressions}</b></div>
        <div className="kpi"><span className="small">Clicks</span><b>{data.clicks}</b></div>
        {data.giftport && <div className="kpi"><span className="small">GiftPort</span><b>{Number(data.giftport?.balance || 0).toFixed(0)}</b></div>}
      </div>
      {data.giftport ? <p className="small">Balance {data.giftport?.currency} · {data.giftport?.message}</p> : <p className="small">Points-only mode: vouchers and GiftPort are off (REWARDS_VOUCHERS_ENABLED=false).</p>}
      <h2>Top matches</h2>
      {(data.top || []).map((row: any) => <div key={row.matchKey} className="board"><span>{row.matchKey}</span><b>{row.views}</b></div>)}
      <div className="admin-grid">
        <button className="admin-card" onClick={() => nav("/admin/crm")}><span>📇</span><b>CRM</b><small>Users, filters, profiles, CSV</small></button>
        <button className="admin-card" onClick={() => nav("/admin/broadcasts")}><span>📣</span><b>Broadcast</b><small>Segments, test, schedule</small></button>
        <button className="admin-card" onClick={() => nav("/admin/automation")}><span>⚙️</span><b>Automations</b><small>Verify nudges, reminders</small></button>
        <button className="admin-card" onClick={() => nav("/admin/channel")}><span>📢</span><b>Channel</b><small>Auto-post cards</small></button>
        <button className="admin-card" onClick={() => nav("/admin/sponsors")}><span>💚</span><b>Sponsors</b><small>Big button in /start + Home</small></button>
        <button className="admin-card" onClick={() => nav("/admin/funnel")}><span>🧭</span><b>Funnel</b><small>Start → verify → predict → return</small></button>
        <button className="admin-card" onClick={() => nav("/admin/settings")}><span>🔔</span><b>Alerts</b><small>New start / verified DMs</small></button>
      </div>
      <button className="report-entry" onClick={() => nav("/admin/reports")}>
        <b>Reports</b>
        <span>Users, play, matches, ads, rewards, channel</span>
      </button>
      <button className="primary" onClick={() => nav("/admin/new")}>New campaign</button>
      <button className="ghost w-full" onClick={() => nav("/admin/users")}>Users</button>
      <button className="ghost w-full" onClick={() => nav("/admin/admins")}>Admins</button>
      {data.features?.vouchers && <button className="ghost w-full" onClick={() => nav("/admin/fulfilment")}>Fulfilment</button>}
    </div>
  );
}

export function CreateCampaign() {
  const [msg, setMsg] = useState("");
  const nav = useNavigate();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const campaign = await api<any>("/api/admin/campaigns", {
        method: "POST",
        body: JSON.stringify({
          brand: fd.get("brand"),
          category: fd.get("category"),
          name: fd.get("name"),
          status: "active",
          flatFee: Number(fd.get("fee") || 0),
          creative: {
            type: fd.get("type"),
            slot: fd.get("slot"),
            headline: fd.get("headline"),
            body: fd.get("body"),
            cta: "Learn more",
            frequencyCap: 5,
          },
        }),
      });
      setMsg(`Live: ${campaign.name}`);
      setTimeout(() => nav("/"), 600);
    }}>
      <h2>New campaign</h2>
      <input className="field" name="brand" placeholder="Brand" required defaultValue="Monsoon Chai" />
      <select className="field" name="category" defaultValue="beverage">
        <option value="audio">Audio</option>
        <option value="fmcg">FMCG</option>
        <option value="beverage">Beverage</option>
        <option value="apparel">Apparel</option>
        <option value="telecom">Telecom</option>
        <option value="auto">Auto</option>
        <option value="finance">Finance</option>
        <option value="retail">Retail</option>
        <option value="other">Other</option>
        <option value="betting">Betting (blocked)</option>
      </select>
      <input className="field" name="name" placeholder="Campaign name" required defaultValue="Monsoon over break" />
      <input className="field" name="headline" placeholder="Headline" required defaultValue="Monsoon Chai" />
      <input className="field" name="body" placeholder="Line" defaultValue="A clean cup at the innings break." />
      <select className="field" name="slot" defaultValue="home_native">
        <option value="home_native">Home native</option>
        <option value="prediction_slot">Prediction slot</option>
        <option value="powered_by">Powered by</option>
        <option value="interstitial">Interstitial</option>
        <option value="leaderboard">Leaderboard</option>
        <option value="celebration">Celebration</option>
        <option value="fan_meter">Fan meter</option>
        <option value="minigame">Mini-game</option>
        <option value="mission">Missions</option>
        <option value="season_pass">Season track</option>
        <option value="cheer">Cheers</option>
        <option value="nudge">Bot nudge</option>
        <option value="avatar">Avatar kit</option>
        <option value="live_pin">Pinned score</option>
        <option value="inline_card">Inline card</option>
        <option value="squad">Squad</option>
        <option value="fan_vote">Fan vote</option>
        <option value="danmaku">Comments</option>
        <option value="chip">Chips</option>
        <option value="pred_streak">Prediction streak</option>
        <option value="puzzle">Puzzle</option>
        <option value="album">Sticker album</option>
        <option value="ticket">Match ticket</option>
        <option value="luck">Luck index</option>
        <option value="league">League</option>
        <option value="fan_xi">Fan XI</option>
      </select>
      <select className="field" name="type" defaultValue="native">
        <option value="native">Native card</option>
        <option value="banner">Banner</option>
        <option value="video">Video</option>
        <option value="interstitial">Interstitial</option>
      </select>
      <input className="field" name="fee" type="number" placeholder="Flat fee INR" defaultValue={20000} />
      <button className="primary">Create paused-safe live slot</button>
      {msg && <p>{msg}</p>}
    </form>
  );
}

export function Users() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  async function load(query = q) {
    const data = await api<{ users: any[] }>(`/api/admin/users?q=${encodeURIComponent(query)}`);
    setRows(data.users);
  }
  useEffect(() => { load(""); }, []);
  return (
    <>
      <h2>Users</h2>
      <form onSubmit={(e) => { e.preventDefault(); load(); }}><input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></form>
      <a className="small" href="/api/admin/users.csv">CSV</a>
      {rows.map((u) => (
        <div key={u.id} className="board">
          <span>{u.firstName} @{u.username}<br /><i className="small">{u.telegramId} · {u.phone || "no phone"} · {u.status}</i></span>
          <button onClick={async () => { await api(`/api/admin/users/${u.id}/block`, { method: "POST", body: JSON.stringify({ blocked: u.status !== "BLOCKED" }) }); load(); }}>{u.status === "BLOCKED" ? "Unblock" : "Block"}</button>
        </div>
      ))}
    </>
  );
}

export function Admins() {
  const [data, setData] = useState<{ admins: any[]; audit: any[] } | null>(null);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState("full");
  const [msg, setMsg] = useState("");

  async function load() {
    setData(await api("/api/admin/admins"));
  }
  useEffect(() => { load().catch(() => setData({ admins: [], audit: [] })); }, []);

  if (!data) return <div className="skel" />;
  return (
    <>
      <h2>Admins</h2>
      <p className="small">Owner and full admin both run the panel. A username locks to a numeric id the first time that person opens the bot or the app.</p>
      <form onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        try {
          await api("/api/admin/admins", { method: "POST", body: JSON.stringify({ handle, role }) });
          setHandle("");
          await load();
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "Could not add that admin.");
        }
      }}>
        <input className="field" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@username or numeric id" required />
        <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="full">Full admin</option>
          <option value="owner">Owner</option>
        </select>
        <button className="primary">Add admin</button>
      </form>
      {msg && <p>{msg}</p>}
      {data.admins.map((row) => (
        <div key={row.id} className="card adminrow">
          <div>
            <b>{row.username ? `@${row.username}` : row.telegramId}</b>
            <div className="small">{row.roleLabel} · {row.bound ? row.telegramId : "Waiting for first open"} · {row.source}</div>
          </div>
          <div className="adminactions">
            <select className="field" value={row.role} onChange={async (e) => {
              setMsg("");
              try {
                await api(`/api/admin/admins/${row.id}/role`, { method: "POST", body: JSON.stringify({ role: e.target.value }) });
                await load();
              } catch (err) {
                setMsg(err instanceof Error ? err.message : "Could not change that role.");
                await load();
              }
            }}>
              <option value="owner">Owner</option>
              <option value="full">Full admin</option>
            </select>
            <button className="ghost" onClick={async () => {
              setMsg("");
              try {
                await api(`/api/admin/admins/${row.id}/remove`, { method: "POST" });
                await load();
              } catch (err) {
                setMsg(err instanceof Error ? err.message : "Could not remove that admin.");
              }
            }}>Remove</button>
          </div>
        </div>
      ))}
      <h2>Audit log</h2>
      {data.audit.map((row) => (
        <div key={row.id} className="board">
          <span>{row.detail}<br /><i className="small">{new Date(row.createdAt).toLocaleString()}</i></span>
        </div>
      ))}
    </>
  );
}

export function Fulfilment() {
  const [rows, setRows] = useState<any[] | null>(null);
  async function load() { setRows((await api<{ orders: any[] }>("/api/admin/fulfilment")).orders); }
  useEffect(() => { load().catch(() => setRows([])); }, []);
  return (
    <>
      <h2>Fulfilment</h2>
      {!rows && <div className="skel" />}
      {rows && rows.length === 0 && <Empty icon="📦" title="No voucher orders yet" text="Voucher wins from the wheel and draws show up here for delivery and retries." />}
      {(rows || []).map((o) => (
        <div key={o.id} className="card">
          <b>{o.brandName}</b> ₹{o.amountInr} · {o.status}
          <div className="small">{o.orderId} {o.redeemCode || ""}</div>
          <button className="ghost" onClick={async () => { await api(`/api/admin/fulfilment/${o.id}/retry`, { method: "POST" }); toast("Retry queued"); load(); }}>Retry</button>
        </div>
      ))}
    </>
  );
}
