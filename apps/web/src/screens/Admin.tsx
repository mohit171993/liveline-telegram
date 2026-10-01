import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib";

export function Dash() {
  const [data, setData] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => { api("/api/admin/overview").then(setData).catch(() => setData({ error: true })); }, []);
  if (!data) return <div className="skel" />;
  if (data.error) return <p>Admin only.</p>;
  return (
    <>
      <h2>Dashboard</h2>
      <div className="kpis">
        <div className="kpi"><span className="small">Users</span><b>{data.active}</b></div>
        <div className="kpi"><span className="small">DAU</span><b>{data.dau}</b></div>
        <div className="kpi"><span className="small">New</span><b>{data.newToday}</b></div>
      </div>
      <div className="kpis">
        <div className="kpi"><span className="small">Impr</span><b>{data.impressions}</b></div>
        <div className="kpi"><span className="small">Clicks</span><b>{data.clicks}</b></div>
        <div className="kpi"><span className="small">GiftPort</span><b>{Number(data.giftport?.balance || 0).toFixed(0)}</b></div>
      </div>
      <p className="small">Balance {data.giftport?.currency} · {data.giftport?.message}</p>
      <h2>Top matches</h2>
      {(data.top || []).map((row: any) => <div key={row.matchKey} className="board"><span>{row.matchKey}</span><b>{row.views}</b></div>)}
      <button className="primary" onClick={() => nav("/admin/new")}>New campaign</button>
      <button className="ghost w-full" onClick={() => nav("/admin/users")}>Users</button>
      <button className="ghost w-full" onClick={() => nav("/admin/fulfilment")}>Fulfilment</button>
    </>
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

export function Fulfilment() {
  const [rows, setRows] = useState<any[]>([]);
  async function load() { setRows((await api<{ orders: any[] }>("/api/admin/fulfilment")).orders); }
  useEffect(() => { load(); }, []);
  return (
    <>
      <h2>Fulfilment</h2>
      {rows.map((o) => (
        <div key={o.id} className="card">
          <b>{o.brandName}</b> ₹{o.amountInr} · {o.status}
          <div className="small">{o.orderId} {o.redeemCode || ""}</div>
          <button className="ghost" onClick={async () => { await api(`/api/admin/fulfilment/${o.id}/retry`, { method: "POST" }); load(); }}>Retry</button>
        </div>
      ))}
    </>
  );
}
