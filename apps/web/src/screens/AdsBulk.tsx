import { useEffect, useRef, useState } from "react";
import { api, apiBase, haptic, initData, toast } from "../lib";
import { Toggle } from "./Crm";
import { mediaSrc, type AdUnit } from "./AdUnits";

/**
 * Ads → Bulk upload + Creative library.
 * Detection mirrors packages/shared/src/adunits.ts (detectAdPosition / creativeStem) — keep in sync.
 */
type Pos = "top" | "infeed" | "sticky" | "interstitial";
type Wide = "top_wide" | "sticky_wide";
type Slot = "default" | Pos | Wide;
/** Bulk-upload / library slot: a position, or the wide (desktop) variant of top / sticky. */
type ItemPos = Pos | Wide;
const basePos = (k: ItemPos): Pos => (k === "top_wide" ? "top" : k === "sticky_wide" ? "sticky" : k);
type Stat = { i: number; c: number };
export type LibAd = AdUnit & {
  name: string; html: string; placements: string[]; pages: string[]; startsAt: number | null; endsAt: number | null;
  priority: number; weight: number; freqCap: number; enabled: boolean; live: boolean; stats: { today: Stat; d7: Stat; d30: Stat };
};
type Sponsor = { id: string; text: string; emoji: string; imageUrl?: string };

const POS_LABEL: Record<Slot, string> = { default: "Any size", top: "Top · mobile", top_wide: "Top · wide (728×90)", infeed: "In-feed", sticky: "Sticky · mobile", sticky_wide: "Sticky · wide", interstitial: "Interstitial" };
const ITEM_POS: ItemPos[] = ["top", "top_wide", "infeed", "sticky", "sticky_wide", "interstitial"];
const PAGES = [{ id: "home", label: "Home" }, { id: "match", label: "Live match" }, { id: "schedule", label: "Schedule" }, { id: "lino", label: "Lino" }];
const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const VID_TYPES = ["video/mp4", "video/webm"];

const KNOWN: [number, number, Pos][] = [
  [728, 90, "top"], [320, 100, "top"], [970, 250, "top"], [970, 90, "top"], [468, 60, "top"], [640, 200, "top"],
  [300, 250, "infeed"], [336, 280, "infeed"], [1200, 628, "infeed"], [1200, 627, "infeed"], [1080, 1080, "infeed"], [600, 600, "infeed"], [1200, 1200, "infeed"],
  [320, 50, "sticky"], [300, 50, "sticky"], [640, 100, "sticky"], [970, 66, "sticky"],
  [320, 480, "interstitial"], [1080, 1920, "interstitial"], [720, 1280, "interstitial"], [480, 320, "infeed"], [300, 600, "interstitial"],
];
export function detectAdPosition(w: number, h: number): Pos {
  if (!(w > 0 && h > 0)) return "infeed";
  for (const [kw, kh, pos] of KNOWN) if (Math.abs(w - kw) <= 2 && Math.abs(h - kh) <= 2) return pos;
  const r = w / h;
  if (r < 0.8) return "interstitial";
  if (r < 2.4) return "infeed";
  if (r >= 10 || (r >= 5 && h <= 60)) return "sticky";
  return "top";
}
/** Mirrors shared detectAdSlot: desktop leaderboards / strips (≥ 700 px wide, ≥ 5:1) fill the wide slot. */
export function detectAdSlot(w: number, h: number): ItemPos {
  const pos = detectAdPosition(w, h);
  if ((pos === "top" || pos === "sticky") && w >= 700 && w / h >= 5) return `${pos}_wide`;
  return pos;
}
export function creativeStem(fileName: string): string {
  const s = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_.]+/g, " ")
    .replace(/\d{2,4}\s*[x×]\s*\d{2,4}/g, " ")
    .replace(/\b(top|leaderboard|infeed|in-feed|feed|sticky|footer|interstitial|fullscreen|full|mobile|mob|desktop|desk|banner|square|story|portrait|landscape|v\d+|final|copy|\d+)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return s || "creative";
}

type Item = { key: string; file: File; preview: string; video: boolean; w: number; h: number; pos: ItemPos; group: string; err?: string };

function dims(file: File, url: string, video: boolean): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    if (video) {
      const v = document.createElement("video");
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => resolve({ w: 0, h: 0 });
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = url;
    }
  });
}

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch(`${apiBase()}/api/admin/adunits/media`, { method: "POST", headers: { authorization: `tma ${initData()}` }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Upload failed");
  return data.url as string;
}

const prettyName = (stem: string) => stem.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 70);

/** Files that share a stem form one campaign; a batch of all-different names counts as one campaign. */
function autoGroup(items: Item[]): Item[] {
  const stems = items.map((i) => creativeStem(i.file.name));
  const allDifferent = new Set(stems).size === stems.length && items.length > 1;
  const batch = prettyName(stems[0] || "Campaign");
  return items.map((it, n) => ({ ...it, group: it.video ? prettyName(stems[n]) + " (video)" : allDifferent ? batch : prettyName(stems[n]) }));
}

export function BulkUpload({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState("");

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const next: Item[] = [];
    for (const file of Array.from(files)) {
      const video = VID_TYPES.includes(file.type);
      const image = IMG_TYPES.includes(file.type);
      const preview = URL.createObjectURL(file);
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      let err = "";
      if (!video && !image) err = "Use PNG, JPG, WebP, GIF, MP4 or WebM";
      else if (image && file.size > 3 * 1024 * 1024) err = "Images max 3 MB";
      else if (video && file.size > 20 * 1024 * 1024) err = "Videos max 20 MB";
      const { w, h } = err ? { w: 0, h: 0 } : await dims(file, preview, video);
      const pos = video ? (w && h && w / h < 0.8 ? "interstitial" : "infeed") : detectAdSlot(w, h);
      next.push({ key, file, preview, video, w, h, pos, group: "", err });
    }
    setItems(autoGroup(next));
  }

  const set = (key: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const good = items.filter((i) => !i.err);
  const groups = [...new Set(good.map((i) => i.group.trim() || "Campaign"))];

  async function create() {
    if (!good.length) return;
    haptic("medium");
    const urls = new Map<string, string>();
    try {
      for (const [n, it] of good.entries()) {
        setBusy(`Uploading ${n + 1}/${good.length}…`);
        urls.set(it.key, await uploadFile(it.file));
      }
      setBusy("Creating draft ads…");
      let made = 0;
      for (const g of groups) {
        const mine = good.filter((i) => (i.group.trim() || "Campaign") === g);
        const videos = mine.filter((i) => i.video);
        const images = mine.filter((i) => !i.video);
        // Banner: one image per position; extra images for an already-filled position become their own ad.
        const buckets: Item[][] = [];
        for (const it of images) {
          const free = buckets.find((b) => !b.some((x) => x.pos === it.pos));
          if (free) free.push(it); else buckets.push([it]);
        }
        for (const [bi, b] of buckets.entries()) {
          const imgs: Partial<Record<Slot, string>> = {};
          for (const it of b) imgs[it.pos] = urls.get(it.key)!;
          imgs.default = imgs.infeed || imgs.top || imgs.top_wide || imgs.sticky || imgs.sticky_wide || imgs.interstitial;
          const positions = [...new Set(b.map((x) => basePos(x.pos)))];
          await api("/api/admin/adunits", { method: "POST", body: JSON.stringify({
            name: (bi ? `${g} (${bi + 1})` : g).slice(0, 80).padEnd(2, "_"), kind: "banner", images: imgs, targetUrl: "", openMode: "inapp",
            placements: positions.flatMap((p) => [`site_${p}`, `app_${p}`]), pages: [], enabled: false,
          }) });
          made++;
        }
        for (const v of videos) {
          await api("/api/admin/adunits", { method: "POST", body: JSON.stringify({
            name: `${g}`.slice(0, 80).padEnd(2, "_"), kind: "video", videoUrl: urls.get(v.key), targetUrl: "", openMode: "inapp",
            placements: [`site_${basePos(v.pos)}`, `app_${basePos(v.pos)}`], pages: [], enabled: false,
          }) });
          made++;
        }
      }
      toast(`${made} draft ad${made === 1 ? "" : "s"} created (off) ✅`);
      items.forEach((i) => URL.revokeObjectURL(i.preview));
      setItems([]);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Bulk upload failed", "err");
    }
    setBusy("");
  }

  return (
    <div className="card bulk">
      <div className="row bulk-head">
        <div><b>Bulk upload</b><p className="small">Pick many files: sizes are read and positions detected automatically. Files with the same name stem (or picked together) become one draft ad.</p></div>
        <span className="chip on bulk-pick">＋ Choose files
          <input ref={input} type="file" multiple accept={[...IMG_TYPES, ...VID_TYPES].join(",")} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
        </span>
      </div>
      <p className="tiny muted">PNG / JPG / WebP / GIF ≤ 3 MB · MP4 / WebM ≤ 20 MB</p>
      {items.length > 0 && <>
        <div className="lib-grid">
          {items.map((it) => (
            <div key={it.key} className={`lib-tile ${it.err ? "bad" : ""}`}>
              <div className="lib-thumb">{it.video ? <video src={it.preview} muted playsInline /> : <img src={it.preview} alt="" />}</div>
              <p className="lib-name" title={it.file.name}>{it.file.name}</p>
              {it.err ? <p className="err tiny">{it.err}</p> : <>
                <p className="tiny muted">{it.w}×{it.h}{it.video ? " · video" : ""}</p>
                <select className="field lib-sel" value={it.pos} aria-label="Position" onChange={(e) => set(it.key, { pos: e.target.value as ItemPos })}>
                  {(it.video ? (["top", "infeed", "sticky", "interstitial"] as ItemPos[]) : ITEM_POS).map((p) => <option key={p} value={p}>{POS_LABEL[p]}</option>)}
                </select>
                <input className="field lib-sel" type="text" value={it.group} maxLength={70} aria-label="Ad (campaign) name" autoComplete="off" spellCheck={false} onChange={(e) => set(it.key, { group: e.target.value })} />
              </>}
              <button className="lib-x" aria-label="Remove" onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))}>✕</button>
            </div>
          ))}
        </div>
        <p className="small">{good.length} file{good.length === 1 ? "" : "s"} → {groups.length} campaign{groups.length === 1 ? "" : "s"}: {groups.join(" · ")}</p>
        <div className="sp-two"><button className="ghost" disabled={Boolean(busy)} onClick={() => setItems([])}>Clear</button><button className="primary" disabled={Boolean(busy) || !good.length} onClick={create}>{busy || "Create draft ads (off)"}</button></div>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------- Creative library */

function Thumb({ src, video }: { src: string; video?: boolean }) {
  const [size, setSize] = useState("");
  return (
    <>
      <div className="lib-thumb">
        {video
          ? <video src={mediaSrc(src)} muted playsInline preload="metadata" onLoadedMetadata={(e) => setSize(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)} />
          : <img src={mediaSrc(src)} alt="" loading="lazy" onLoad={(e) => setSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />}
      </div>
      <p className="tiny muted">{size || "…"}{video ? " · video" : ""}</p>
    </>
  );
}

function LibCard({ ad, sponsors, reload }: { ad: LibAd; sponsors: Sponsor[]; reload: () => void }) {
  const [images, setImages] = useState<Partial<Record<Slot, string>>>(ad.images);
  const [link, setLink] = useState(ad.targetUrl);
  const [site, setSite] = useState(ad.placements.some((p) => p.startsWith("site_")) || !ad.placements.length);
  const [app, setApp] = useState(ad.placements.some((p) => p.startsWith("app_")));
  const [pages, setPages] = useState<string[]>(ad.pages);
  const [autoClose, setAutoClose] = useState(String(ad.autoCloseS ?? 10));
  const [saving, setSaving] = useState(false);
  // Cards are keyed by id only (never remounted while typing). When the saved row changes on the
  // server, adopt it, but never overwrite a field the admin is editing right now.
  const linkRef = useRef<HTMLInputElement>(null);
  const rowSig = `${ad.autoCloseS}|${ad.targetUrl}|${ad.placements.join()}|${ad.pages.join()}|${JSON.stringify(ad.images)}`;
  const firstSig = useRef(rowSig);
  useEffect(() => {
    if (firstSig.current === rowSig) return;
    firstSig.current = rowSig;
    setImages(ad.images);
    if (document.activeElement !== linkRef.current) setLink(ad.targetUrl);
    setSite(ad.placements.some((p) => p.startsWith("site_")) || !ad.placements.length);
    setApp(ad.placements.some((p) => p.startsWith("app_")));
    setPages(ad.pages);
    setAutoClose(String(ad.autoCloseS ?? 10));
  }, [rowSig]);
  const dirty = JSON.stringify(images) !== JSON.stringify(ad.images) || link !== ad.targetUrl || pages.join() !== ad.pages.join()
    || site !== ad.placements.some((p) => p.startsWith("site_")) || app !== ad.placements.some((p) => p.startsWith("app_"))
    || closeSecs() !== (ad.autoCloseS ?? 10);
  function closeSecs() { const n = Math.round(Number(autoClose)); return Number.isFinite(n) ? Math.min(120, Math.max(0, n)) : 10; }

  function positions(): Pos[] {
    if (ad.kind === "banner") {
      const own = [...new Set((Object.keys(images) as Slot[]).filter((k): k is ItemPos => k !== "default" && Boolean(images[k])).map(basePos))];
      if (own.length) return own;
    }
    const prev = [...new Set(ad.placements.map((p) => p.split("_")[1] as Pos))];
    return prev.length ? prev : ["infeed"];
  }
  function move(from: Slot, to: Slot | "none") {
    setImages((cur) => {
      const next = { ...cur };
      const url = next[from];
      delete next[from];
      if (to !== "none" && url) next[to] = url;
      if (from === "default" || !next.default) next.default = next.infeed || next.top || next.top_wide || next.sticky || next.sticky_wide || next.interstitial || (to === "default" ? url : undefined);
      if (!next.default) delete next.default;
      return next;
    });
  }
  async function save(enabled = ad.enabled) {
    const pos = positions();
    const placements = [...(site ? pos.map((p) => `site_${p}`) : []), ...(app && ad.kind !== "html" ? pos.map((p) => `app_${p}`) : [])];
    if (!placements.length) { toast("Tick Website and/or Mini App", "err"); return; }
    setSaving(true);
    try {
      await api(`/api/admin/adunits/${ad.id}`, { method: "PUT", body: JSON.stringify({
        name: ad.name, kind: ad.kind, title: ad.title, body: ad.body, cta: ad.cta, images, videoUrl: ad.videoUrl, posterUrl: ad.posterUrl, html: ad.html,
        targetUrl: link.trim(), openMode: ad.openMode, placements, pages,
        startsAt: ad.startsAt ? new Date(ad.startsAt).toISOString() : null, endsAt: ad.endsAt ? new Date(ad.endsAt).toISOString() : null,
        priority: ad.priority, weight: ad.weight, freqCap: ad.freqCap, autoCloseS: closeSecs(), enabled,
      }) });
      toast(enabled !== ad.enabled ? (enabled ? "Ad on" : "Ad off") : "Saved ✅");
      reload();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save", "err"); }
    setSaving(false);
  }
  async function sponsorImage(sponsorId: string, url: string) {
    if (!sponsorId) return;
    try { await api(`/api/admin/sponsors/${sponsorId}/image`, { method: "POST", body: JSON.stringify({ imageUrl: url }) }); toast("Sponsor image set ✅"); }
    catch (e) { toast(e instanceof Error ? e.message : "Failed", "err"); }
  }

  const slots = (Object.keys(images) as Slot[]).filter((k) => images[k] && !(k === "default" && Object.entries(images).some(([o, v]) => o !== "default" && v === images.default)));
  return (
    <div className="card lib-card">
      <div className="row"><b className="lib-title">{ad.name}</b><Toggle on={ad.enabled} onChange={(v) => save(v)} label="On" /></div>
      <p className="tiny muted">{ad.live ? "🟢 Live" : ad.enabled ? "🕒 Scheduled" : "⚪ Draft / off"} · {ad.kind}</p>
      <div className="lib-grid">
        {ad.kind === "video" && ad.videoUrl && <div className="lib-tile"><Thumb src={ad.videoUrl} video /><span className="lib-chip">{POS_LABEL[positions()[0]]}</span></div>}
        {slots.map((k) => (
          <div key={k} className="lib-tile">
            <Thumb src={images[k]!} />
            <select className="field lib-sel" value={k} aria-label="Position" onChange={(e) => move(k, e.target.value as Slot | "none")}>
              {([...ITEM_POS, "default"] as Slot[]).map((p) => <option key={p} value={p} disabled={p !== k && Boolean(images[p])}>{POS_LABEL[p]}</option>)}
              <option value="none">— Don't show</option>
            </select>
            {sponsors.length > 0 && (
              <select className="field lib-sel" value="" aria-label="Use as sponsor image" onChange={(e) => sponsorImage(e.target.value, images[k]!)}>
                <option value="">Use as sponsor image…</option>
                {sponsors.map((s) => <option key={s.id} value={s.id}>{`${s.emoji ? `${s.emoji} ` : ""}${s.text}`}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
      <label className="small" htmlFor={`lib-link-${ad.id}`}>Link (https)</label>
      <input ref={linkRef} id={`lib-link-${ad.id}`} className="field" type="url" inputMode="url" name="targetUrl" value={link} placeholder="https://brand.example/offer"
        autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"
        onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} />
      {positions().includes("interstitial") && <>
        <label className="small" htmlFor={`lib-close-${ad.id}`}>Auto-close (seconds, 0 = off)</label>
        <input id={`lib-close-${ad.id}`} className="field" type="number" inputMode="numeric" min={0} max={120} value={autoClose} onChange={(e) => setAutoClose(e.target.value)} />
      </>}
      <div className="lib-checks">
        <label className={`am-check ${site ? "on" : ""}`}><input type="checkbox" checked={site} onChange={() => setSite(!site)} />🌐 Website</label>
        <label className={`am-check ${app ? "on" : ""}`}><input type="checkbox" checked={app} disabled={ad.kind === "html"} onChange={() => setApp(!app)} />📱 Mini App</label>
      </div>
      <div className="chips">{PAGES.map((p) => <button key={p.id} className={`chip ${pages.includes(p.id) ? "on" : ""}`} onClick={() => setPages((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}>{p.label}</button>)}<span className="tiny muted">{pages.length ? "" : "All screens"}</span></div>
      {dirty && <button className="primary w-full" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save changes"}</button>}
    </div>
  );
}

export function CreativeLibrary({ ads, reload }: { ads: LibAd[]; reload: () => void }) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  useEffect(() => { api<{ sponsors: Sponsor[] }>("/api/admin/sponsors").then((r) => setSponsors(r.sponsors)).catch(() => undefined); }, []);
  const media = ads.filter((a) => (a.kind === "banner" || a.kind === "native" ? Object.values(a.images).some(Boolean) : a.kind === "video" ? Boolean(a.videoUrl) : false));
  if (!media.length) return null;
  return (
    <div className="lib">
      <h3>🗂 Creative library</h3>
      {media.map((a) => <LibCard key={a.id} ad={a} sponsors={sponsors} reload={reload} />)}
    </div>
  );
}
