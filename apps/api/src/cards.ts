import type { MatchView } from "@liveline/shared";

export function scoreCardSvg(view: MatchView, kind: "score" | "prediction" = "score"): string {
  const live = view.live;
  const headline = live
    ? `${view.teams[live.batting].code}  ${live.runs}/${live.wickets}`
    : view.result || "Upcoming";
  const sub = live ? `${live.overs} ov · ${live.need || `CRR ${live.crr}`}` : view.toss;
  const a = view.teams.a;
  const b = view.teams.b;
  const win = live ? `${a.code} ${live.win.a}%   ${b.code} ${live.win.b}%` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#10131c"/>
      <stop offset="1" stop-color="#07080d"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1350" fill="url(#g)"/>
  <rect x="0" y="0" width="18" height="1350" fill="${a.color}"/>
  <rect x="1062" y="0" width="18" height="1350" fill="${b.color}"/>
  <text x="72" y="140" fill="#e6ff4d" font-family="Arial, sans-serif" font-size="28" letter-spacing="6">LIVELINE PRO</text>
  <text x="72" y="210" fill="#9aa3b5" font-family="Arial, sans-serif" font-size="32">${escapeXml(view.seriesName)} · ${escapeXml(view.format)}</text>
  <text x="72" y="320" fill="#f4f6fb" font-family="Arial, sans-serif" font-size="54">${escapeXml(view.name)}</text>
  <text x="72" y="520" fill="#f4f6fb" font-family="Arial Black, Arial, sans-serif" font-size="120">${escapeXml(headline)}</text>
  <text x="72" y="610" fill="#d5dbea" font-family="Arial, sans-serif" font-size="40">${escapeXml(sub)}</text>
  <text x="72" y="700" fill="#9aa3b5" font-family="Arial, sans-serif" font-size="32">${escapeXml(win)} ${kind === "prediction" ? "· points only" : ""}</text>
  <text x="72" y="1220" fill="#6d7588" font-family="Arial, sans-serif" font-size="28">${escapeXml(view.venue)} · ${escapeXml(view.city)}</text>
  <text x="72" y="1280" fill="#e6ff4d" font-family="Arial, sans-serif" font-size="28">t.me/LiveLineProBot</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch] || ch));
}

export async function svgToPng(svg: string): Promise<Buffer | null> {
  try {
    const specifier = "@resvg/resvg-js";
    const mod = (await import(specifier)) as {
      Resvg: new (svg: string, opts: { fitTo: { mode: "width"; value: number } }) => { render: () => { asPng: () => Uint8Array } };
    };
    return Buffer.from(new mod.Resvg(svg, { fitTo: { mode: "width", value: 1080 } }).render().asPng());
  } catch {
    return null;
  }
}
