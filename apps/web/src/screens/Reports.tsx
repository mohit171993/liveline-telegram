import { useEffect, useState } from "react";
import { SponsorTapsTable } from "./Sponsor";
import { AdUnitsTable, type AdUnitReportRow } from "./AdsManager";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, apiBase, haptic, initData } from "../lib";

type Preset = "today" | "7d" | "30d" | "custom";
type SectionId = "users" | "engagement" | "matches" | "ads" | "rewards" | "channel";
type Kpi = { id: string; label: string; display: string; delta: number | null };
type Chart = { id: string; title: string; kind: "line" | "bar"; points: { x: string; y: number }[] };
type Table = { id: string; title: string; columns: [string, string]; rows: { label: string; value: string }[] };
type Report = {
  range: { preset: string; from: string; to: string };
  sections: Record<SectionId, { title: string; kpis: Kpi[]; charts: Chart[]; tables: Table[] }>;
};

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "engagement", label: "Play" },
  { id: "matches", label: "Matches" },
  { id: "ads", label: "Ads" },
  { id: "rewards", label: "Rewards" },
  { id: "channel", label: "Channel" },
];

export function Reports() {
  const nav = useNavigate();
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [section, setSection] = useState<SectionId>("users");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [sponsorRows, setSponsorRows] = useState<Parameters<typeof SponsorTapsTable>[0]["rows"]>();
  const [adRows, setAdRows] = useState<AdUnitReportRow[]>();
  const days = preset === "today" ? 1 : preset === "30d" ? 30 : preset === "7d" ? 7 : 30;
  useEffect(() => {
    api<{ rows: NonNullable<typeof sponsorRows> }>(`/api/admin/sponsors/report?days=${days}`).then((r) => setSponsorRows(r.rows)).catch(() => setSponsorRows(undefined));
    api<{ rows: AdUnitReportRow[] }>(`/api/admin/adunits/report?days=${days}`).then((r) => setAdRows(r.rows)).catch(() => setAdRows(undefined));
  }, [preset]);

  const ready = preset !== "custom" || (Boolean(from) && Boolean(to));
  const query = new URLSearchParams({ preset });
  if (preset === "custom") {
    query.set("from", from);
    query.set("to", to);
  }

  useEffect(() => {
    if (!ready) {
      setData(null);
      return;
    }
    let live = true;
    setData(null);
    setError("");
    api<Report>(`/api/admin/analytics?${query.toString()}`)
      .then((res) => { if (live) setData(res); })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : "Admin only."); });
    return () => { live = false; };
  }, [preset, from, to, ready]);

  async function download() {
    haptic("light");
    const res = await fetch(`${apiBase()}/api/admin/analytics.csv?${query.toString()}&section=${section}`, {
      headers: { authorization: `tma ${initData()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liveline-${section}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const block = data?.sections[section];

  return (
    <div className="reports">
      <div className="report-head">
        <button className="textlink" onClick={() => nav("/admin")}>Admin</button>
        <h2>Reports</h2>
        <button className="chip on" onClick={download} disabled={!data}>CSV</button>
      </div>
      <div className="chips">
        {(["today", "7d", "30d", "custom"] as Preset[]).map((id) => (
          <button key={id} className={`chip ${preset === id ? "on" : ""}`} onClick={() => { haptic("light"); setPreset(id); }}>
            {id === "today" ? "Today" : id === "custom" ? "Custom" : id}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="range">
          <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
      )}
      {data && <p className="small">{data.range.from} – {data.range.to} · vs the previous window</p>}
      <div className="chips">
        {SECTIONS.map((item) => (
          <button key={item.id} className={`chip ${section === item.id ? "on" : ""}`} onClick={() => { haptic("light"); setSection(item.id); }}>
            {item.label}
          </button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      {!block && !error && <><div className="skel" /><div className="skel" /><div className="skel" /></>}
      {block && (
        <motion.div key={`${section}-${data?.range.from}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <div className="kpis report-kpis">
            {block.kpis.map((row) => (
              <div key={row.id} className="kpi">
                <span className="small">{row.label}</span>
                <b>{row.display}</b>
                <Delta delta={row.delta} />
              </div>
            ))}
          </div>
          {block.charts.map((chart) => (
            <div key={chart.id} className="card report-chart">
              <div className="small">{chart.title}</div>
              {chart.kind === "line" ? <LineChart points={chart.points} /> : <BarChart points={chart.points} />}
            </div>
          ))}
          {block.tables.map((table) => (
            <div key={table.id}>
              <h3>{table.title}</h3>
              {table.rows.length === 0 && <p className="small">Nothing in this range.</p>}
              <div className="rows">
                {table.rows.map((row) => (
                  <div key={row.label}><span>{row.label}</span><b>{row.value}</b></div>
                ))}
              </div>
            </div>
          ))}
        </motion.div>
      )}
      <SponsorTapsTable rows={sponsorRows} />
      <AdUnitsTable rows={adRows} days={days} />
    </div>
  );
}

function Delta({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  if (delta === 0) return <span className="delta flat">0%</span>;
  const up = delta > 0;
  return <span className={up ? "delta up" : "delta down"}>{up ? "↑" : "↓"} {Math.abs(delta)}%</span>;
}

function LineChart({ points }: { points: { x: string; y: number }[] }) {
  if (!points.length) return <p className="small">No activity in this range.</p>;
  const w = 320;
  const h = 128;
  const pad = 16;
  const max = Math.max(1, ...points.map((p) => p.y));
  const coords = points.map((p, i) => {
    const x = pad + (points.length === 1 ? (w - pad * 2) / 2 : (i / (points.length - 1)) * (w - pad * 2));
    const y = h - pad - (p.y / max) * (h - pad * 2);
    return { x, y, label: p.x };
  });
  const d = coords.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${d} L${coords[coords.length - 1].x.toFixed(1)},${h - pad} L${coords[0].x.toFixed(1)},${h - pad} Z`;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Line chart">
      <path d={area} fill="rgba(61,255,232,0.16)" />
      <path d={d} fill="none" stroke="#3DFFE8" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {coords.filter((_, i) => i === 0 || i === coords.length - 1 || coords.length < 8).map((c) => (
        <text key={c.label + c.x} x={c.x} y={h - 2} textAnchor="middle" fill="currentColor" fontSize="9" opacity="0.7">{c.label}</text>
      ))}
    </svg>
  );
}

function BarChart({ points }: { points: { x: string; y: number }[] }) {
  if (!points.length) return <p className="small">No activity in this range.</p>;
  const w = 320;
  const h = 128;
  const pad = 16;
  const max = Math.max(1, ...points.map((p) => p.y));
  const gap = 4;
  const bw = Math.max(4, (w - pad * 2 - gap * (points.length - 1)) / points.length);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Bar chart">
      {points.map((p, i) => {
        const bh = (p.y / max) * (h - pad * 2);
        const x = pad + i * (bw + gap);
        const y = h - pad - bh;
        return <rect key={p.x + i} x={x} y={y} width={bw} height={Math.max(bh, p.y ? 2 : 0)} rx="3" fill={i % 2 ? "#E7FF4D" : "#3DFFE8"} />;
      })}
    </svg>
  );
}
