import { useEffect, useRef, useState } from "react";
import { api, apiBase, haptic } from "../lib";

/** Ads manager creatives (admin "🖼 Ads"), served per screen by /api/adunits?page=… */
export type AdUnit = {
  id: string; kind: "banner" | "native" | "video" | "html"; title: string; body: string; cta: string;
  images: Partial<Record<"default" | "top" | "infeed" | "sticky" | "interstitial" | "top_wide" | "sticky_wide", string>>;
  videoUrl: string; posterUrl: string; targetUrl: string; openMode: "inapp" | "external"; frameable: boolean; freqCap: number; autoCloseS?: number;
};
export type AdPage = "home" | "match" | "schedule" | "lino";
export type AdPos = "top" | "infeed" | "sticky" | "interstitial";
type Picks = Partial<Record<AdPos, AdUnit>>;

export const mediaSrc = (u?: string) => (!u ? "" : u.startsWith("/") ? `${apiBase()}${u}` : u);
/** Same rules as @liveline/shared adImage / adImageWide (mobile creative, plus a 728×90-style one for wide screens). */
const WIDE_MIN_PX = 600;
const wideKey = (pos: AdPos) => (pos === "top" ? "top_wide" : pos === "sticky" ? "sticky_wide" : null);
const imageFor = (ad: AdUnit, pos: AdPos) => ad.images[pos] || (wideKey(pos) ? ad.images[wideKey(pos)!] : "") || ad.images.default || "";
const wideImageFor = (ad: AdUnit, pos: AdPos) => { const k = wideKey(pos); const w = k ? ad.images[k] || "" : ""; return w && w !== imageFor(ad, pos) ? w : ""; };
const today = () => new Date().toISOString().slice(0, 10);

export function useAdUnits(page: AdPage): Picks {
  const [ads, setAds] = useState<Picks>({});
  useEffect(() => {
    let live = true;
    api<{ ads: Picks }>(`/api/adunits?page=${page}`).then((r) => { if (live) setAds(r.ads || {}); }).catch(() => undefined);
    return () => { live = false; };
  }, [page]);
  return ads;
}

function track(ad: AdUnit, type: "impression" | "click", pos: AdPos, page: AdPage) {
  return api(`/api/adunits/${ad.id}/event`, { method: "POST", body: JSON.stringify({ type, placement: `app_${pos}`, page }) }).catch(() => undefined);
}

function useImpression(ad: AdUnit | undefined, pos: AdPos, page: AdPage) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ad || !ref.current) return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (!done && entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) { done = true; track(ad, "impression", pos, page); io.disconnect(); }
    }, { threshold: [0.5] });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ad?.id, pos, page]);
  return ref;
}

function Creative({ ad, pos }: { ad: AdUnit; pos: AdPos }) {
  if (ad.kind === "video") {
    return <video className="au-video" src={mediaSrc(ad.videoUrl)} poster={mediaSrc(ad.posterUrl) || undefined} autoPlay muted loop playsInline preload="metadata" />;
  }
  if (ad.kind === "native") {
    return (
      <div className="au-native">
        {imageFor(ad, pos) && <img src={mediaSrc(imageFor(ad, pos))} alt="" loading="lazy" />}
        <div><b>{ad.title}</b>{ad.body && <p>{ad.body}</p>}{ad.cta && <span className="au-cta">{ad.cta}</span>}</div>
      </div>
    );
  }
  const img = <img className="au-img" src={mediaSrc(imageFor(ad, pos))} alt={ad.title || "Sponsored"} loading={pos === "infeed" ? "lazy" : "eager"} />;
  const wide = wideImageFor(ad, pos);
  return wide ? <picture className="au-pic"><source media={`(min-width: ${WIDE_MIN_PX}px)`} srcSet={mediaSrc(wide)} />{img}</picture> : img;
}

/** Opens the target: in-app (inside the Mini App when the site allows framing) or the browser. */
function useOpener() {
  const [frame, setFrame] = useState<string | null>(null);
  function open(ad: AdUnit) {
    const url = ad.targetUrl;
    if (!url) return;
    const tg = window.Telegram?.WebApp;
    if (/^https:\/\/t\.me\//i.test(url) && tg?.openTelegramLink) return tg.openTelegramLink(url);
    if (ad.openMode === "inapp" && ad.frameable) return setFrame(url);
    if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank", "noopener");
  }
  const view = frame ? (
    <div className="au-frame" role="dialog" aria-label="Sponsored page">
      <div className="au-frame-bar"><button className="ghost" onClick={() => setFrame(null)}>✕ Close</button><button className="ghost" onClick={() => { window.Telegram?.WebApp?.openLink?.(frame); }}>Open in browser ↗</button></div>
      <iframe src={frame} title="Sponsored" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  ) : null;
  return { open, view };
}

export function AdUnitView({ ad, pos, page }: { ad?: AdUnit; pos: "top" | "infeed"; page: AdPage }) {
  const ref = useImpression(ad, pos, page);
  const { open, view } = useOpener();
  if (!ad) return null;
  return (
    <>
      <div ref={ref} className={`au au-${pos} au-k-${ad.kind}`} role="link" tabIndex={0}
        onClick={() => { haptic("light"); track(ad, "click", pos, page); open(ad); }}>
        <Creative ad={ad} pos={pos} />
        <small className="au-tag">Ad</small>
      </div>
      {view}
    </>
  );
}

export function AdSticky({ ad, page }: { ad?: AdUnit; page: AdPage }) {
  const [closed, setClosed] = useState(() => (ad ? sessionStorage.getItem(`ll-sticky-x:${ad.id}`) === "1" : false));
  const ref = useImpression(closed ? undefined : ad, "sticky", page);
  const { open, view } = useOpener();
  if (!ad || closed) return null;
  return (
    <>
      <div ref={ref} className={`au au-sticky au-k-${ad.kind}`} onClick={() => { track(ad, "click", "sticky", page); open(ad); }}>
        <Creative ad={ad} pos="sticky" />
        <small className="au-tag">Ad</small>
        <button className="au-x" aria-label="Close ad" onClick={(e) => { e.stopPropagation(); sessionStorage.setItem(`ll-sticky-x:${ad.id}`, "1"); setClosed(true); }}>✕</button>
      </div>
      {view}
    </>
  );
}

/** Countdown ring around the ✕ (always tappable). */
function CloseRing({ left, total, onClose }: { left: number; total: number; onClose: () => void }) {
  const R = 17, C = 2 * Math.PI * R;
  const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <button type="button" className="au-inter-x" aria-label={total > 0 ? `Close ad (closes in ${Math.ceil(left)} s)` : "Close ad"}
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      {total > 0 && <span className="au-inter-left">Closes in {Math.ceil(left)}s</span>}
      <span className="au-ring">
        {total > 0 && <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r={R} className="au-ring-bg" /><circle cx="20" cy="20" r={R} className="au-ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} /></svg>}
        <b aria-hidden="true">✕</b>
      </span>
    </button>
  );
}

/** Seconds left on a countdown that only runs while the page is visible. */
function useVisibleCountdown(active: boolean, total: number, onDone: () => void): number {
  const [left, setLeft] = useState(total);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!active || total <= 0) return;
    setLeft(total);
    let remaining = total * 1000;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      if (!document.hidden) remaining -= now - last; // paused while the tab / Mini App is hidden
      last = now;
      setLeft(Math.max(0, remaining / 1000));
      if (remaining <= 0) { clearInterval(t); done.current(); }
    }, 200);
    return () => clearInterval(t);
  }, [active, total]);
  return left;
}

/**
 * Fullscreen interstitial with a per-day frequency cap (freqCap 0 = no cap). It closes by itself after
 * autoCloseS seconds (0 = off; paused while hidden); the ✕ works at any time and never counts as a click.
 */
export function AdInterstitial({ ad, page }: { ad?: AdUnit; page: AdPage }) {
  const [show, setShow] = useState(false);
  const { open, view } = useOpener();
  const total = Math.max(0, Math.min(120, ad?.autoCloseS ?? 10));
  const left = useVisibleCountdown(show, total, () => setShow(false));
  useEffect(() => {
    if (!ad) return;
    const key = `ll-adcap:${ad.id}:${today()}`;
    const seen = Number(localStorage.getItem(key) || 0);
    if (ad.freqCap > 0 && seen >= ad.freqCap) return;
    localStorage.setItem(key, String(seen + 1));
    setShow(true);
    track(ad, "impression", "interstitial", page);
  }, [ad?.id]);
  if (!ad || !show) return view;
  return (
    <div className="au-inter" role="dialog" aria-label="Advertisement">
      <div className="au-inter-card" onClick={() => { track(ad, "click", "interstitial", page); open(ad); }}>
        <Creative ad={ad} pos="interstitial" />
        {ad.cta && ad.kind !== "native" && <span className="au-cta big">{ad.cta}</span>}
      </div>
      <CloseRing left={left} total={total} onClose={() => setShow(false)} />
      <small className="au-tag">Ad</small>
      {view}
    </div>
  );
}
