import { Component, useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api, haptic, t, type Match, type Me } from "./lib";
import { Avatar } from "./Avatar";
import { Flag } from "./flags";
import { useTheme, Wordmark } from "./brand/Brand";
export function pillClass(ball: string) {
  if (ball === "W") return "pill w";
  if (ball === "4") return "pill b4";
  if (ball === "6") return "pill b6";
  return "pill";
}

export function AppHeader({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { theme, toggle } = useTheme();
  const lang = me.user.language === "hi" ? "hi" : "en";

  async function choose(next: "en" | "hi") {
    if (next === lang) return;
    await api("/api/auth/language", { method: "POST", body: JSON.stringify({ language: next }) });
    haptic("light");
    onMe({ ...me, user: { ...me.user, language: next } });
  }

  return (
    <>
      <header className="topbar">
        <Wordmark theme={theme} />
        <div className="top-actions">
          <button className="points" onClick={() => { haptic("light"); nav("/board"); }}>{me.user.points} {t(lang, "points")}</button>
          <button className="avatar-btn" aria-label="Settings" onClick={() => { haptic("light"); setOpen(true); }}>
            <Avatar look={me.user.look} size={36} />
          </button>
        </div>
      </header>
      <AnimatePresence>
        {open && (
          <motion.div className="sheet-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              className="sheet"
              role="dialog"
              aria-label="Settings"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sheet-grip" />
              <h2>Settings</h2>
              <div className="sheet-row">
                <span>Theme</span>
                <button className="chip on" onClick={toggle}>{theme === "dark" ? "Light" : "Dark"}</button>
              </div>
              <div className="sheet-row">
                <span>Language</span>
                <div className="seg">
                  <button className={lang === "en" ? "on" : ""} onClick={() => choose("en")}>English</button>
                  <button className={lang === "hi" ? "on" : ""} onClick={() => choose("hi")}>हिंदी</button>
                </div>
              </div>
              <button className="ghost" onClick={() => { setOpen(false); nav("/avatar"); }}>Edit kit</button>
              {me.user.admin && <button className="ghost" onClick={() => { setOpen(false); nav("/admin"); }}>Admin</button>}
              <button className="primary" onClick={() => setOpen(false)}>Done</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  live: "M4 12h2l2-5 4 10 2-5h6",
  predict: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  rewards: "M12 3l2.2 4.6L19 8.2l-3.5 3.4.8 4.9L12 14.8 7.7 16.5l.8-4.9L5 8.2l4.8-.6z",
  alerts: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5zM10 19a2 2 0 0 0 4 0",
  play: "M8 5v14l12-7z",
  spin: "M12 4a8 8 0 1 1-7.5 5",
  channel: "M4 12h10M10 8l4 4-4 4M14 6h6v12h-6",
  lino: "M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM9 11h.01M15 11h.01",
};

export function TabBar({ lang }: { lang: string }) {
  const items: { to: string; key: "home" | "live" | "predict" | "rewards" | "alerts"; icon: keyof typeof ICONS }[] = [
    { to: "/", key: "home", icon: "home" },
    { to: "/live", key: "live", icon: "live" },
    { to: "/predict", key: "predict", icon: "predict" },
    { to: "/rewards", key: "rewards", icon: "rewards" },
    { to: "/alerts", key: "alerts", icon: "alerts" },
  ];
  return (
    <nav className="nav">
      {items.map((item) => (
        <NavLink key={item.key} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "on" : "")} onClick={() => haptic("light")}>
          <Icon d={ICONS[item.icon]} />
          <span>{t(lang, item.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function QuickRow({ channelUrl }: { channelUrl: string | null }) {
  const nav = useNavigate();
  const actions = [
    { label: "Play", icon: ICONS.play, go: () => nav("/play") },
    { label: "Predict", icon: ICONS.predict, go: () => nav("/predict") },
    { label: "Spin", icon: ICONS.spin, go: () => nav("/rewards") },
    { label: "Ask Lino", icon: ICONS.lino, go: () => nav("/ai") },
    { label: "Channel", icon: ICONS.channel, go: () => {
      if (!channelUrl) return;
      if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(channelUrl);
      else window.open(channelUrl, "_blank", "noopener");
    } },
  ];
  return (
    <div className="quick">
      {actions.map((action) => (
        <button key={action.label} onClick={() => { haptic("light"); action.go(); }}>
          <span className="quick-icon"><Icon d={action.icon} /></span>
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function StreakBanner({ me }: { me: Me }) {
  const nav = useNavigate();
  const days = me.user.dailyStreak || 0;
  return (
    <button className="streak" onClick={() => { haptic("light"); nav("/pass"); }}>
      <b>{days > 0 ? `${days} day streak` : "Start a streak"}</b>
      <span>{me.user.rank?.name || "Season"} · free track</span>
    </button>
  );
}

function when(match: Match) {
  if (match.status === "live") return "LIVE";
  if (match.status === "completed") return match.result || "Result";
  return kickoff(match.startAt).headline;
}

export function kickoff(startAt: number, now = Date.now()) {
  const clock = new Date(startAt).toLocaleString("en-IN", {
    hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
  const ms = startAt - now;
  if (ms <= 0 || ms >= 48 * 60 * 60 * 1000) return { headline: clock, clock: "" };
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const headline = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return { headline, clock };
}

export function placeOf(match: { venue?: string; city?: string }) {
  return [match.venue, match.city].filter(Boolean).join(", ");
}

export function HeroCard({ match, lang }: { match: Match; lang: string }) {
  const nav = useNavigate();
  const live = match.live;
  const bat = live ? match.teams[live.batting] : match.teams.a;
  const start = kickoff(match.startAt);
  const place = placeOf(match);
  const detail = [start.clock, place].filter(Boolean).join(" · ");
  return (
    <motion.button
      className={`hero slide ${match.status === "live" ? "is-live" : ""}`}
      onClick={() => { haptic("medium"); nav(`/match/${match.key}`); }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 18, stiffness: 180 }}
    >
      <div className="row">
        <span className="livepill">{match.status === "live" && <i className="dot" />} {when(match)}</span>
        <span className="demo">{match.demo ? t(lang, "demo") : match.seriesName}</span>
      </div>
      <div className={`versus ${live ? "" : "pair"}`}>
        <div className="side">
          <Flag code={match.teams.a.code} size={40} />
          <strong>{match.teams.a.code}</strong>
          <em>{match.scoreline.a || "—"}</em>
        </div>
        {live && <div className="score" style={{ color: bat.color }}>{live.runs}/{live.wickets}</div>}
        <div className="side">
          <Flag code={match.teams.b.code} size={40} />
          <strong>{match.teams.b.code}</strong>
          <em>{match.scoreline.b || "—"}</em>
        </div>
      </div>
      {live ? (
        <div className="need">{lang === "hi" ? live.needHi : live.need || match.name}</div>
      ) : match.status === "completed" ? (
        <div className="hero-state"><b>{match.result || "Result"}</b></div>
      ) : (
        <div className="hero-state">
          <b>{start.headline}</b>
          {detail && <span>{detail}</span>}
        </div>
      )}
      <div className="stripe" style={{ background: `linear-gradient(90deg, ${match.teams.a.color}, ${match.teams.b.color})` }} />
      {live && <div className="meta">{live.overs} ov · {t(lang, "crr")} {live.crr} · {t(lang, "rrr")} {live.rrr ?? "—"}</div>}
      {live && (
        <div className="pills">{(live.recent || []).slice(-8).map((b, i) => <span key={i} className={pillClass(b)}>{b}</span>)}</div>
      )}
    </motion.button>
  );
}

export function MatchCard({ match }: { match: Match }) {
  const nav = useNavigate();
  return (
    <button className="match" onClick={() => { haptic("light"); nav(`/match/${match.key}`); }}>
      <div className="stripe" style={{ background: `linear-gradient(90deg, ${match.teams.a.color}, ${match.teams.b.color})` }} />
      <div className="row">
        <b>{match.seriesName || match.name}</b>
        <span className={`status ${match.status}`}>{when(match)}</span>
      </div>
      <div className="match-sides">
        <div><Flag code={match.teams.a.code} size={28} /><strong>{match.teams.a.name}</strong><em>{match.scoreline.a || "—"}</em></div>
        <div><Flag code={match.teams.b.code} size={28} /><strong>{match.teams.b.name}</strong><em>{match.scoreline.b || "—"}</em></div>
      </div>
    </button>
  );
}

/** Toasts from toast() in lib.ts, so every tap gets visible feedback. */
export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string; kind: string }[]>([]);
  useEffect(() => {
    const on = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; kind: string }>).detail;
      const id = Date.now() + Math.random();
      setItems((cur) => [...cur.slice(-2), { id, ...detail }]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 2800);
    };
    window.addEventListener("ll-toast", on);
    return () => window.removeEventListener("ll-toast", on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => <div key={item.id} className={`toast ${item.kind}`}>{item.text}</div>)}
    </div>
  );
}

/** Friendly empty state with an optional call to action. */
export function Empty({ icon, title, text, cta, onCta }: { icon: string; title: string; text?: string; cta?: string; onCta?: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <b>{title}</b>
      {text && <p className="small">{text}</p>}
      {cta && onCta && <button className="primary" onClick={onCta}>{cta}</button>}
    </div>
  );
}

/** No screen is ever blank: a crash in one screen shows this card, not a white page. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("screen crashed", error); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">🏏</div>
        <b>This screen hit a no-ball</b>
        <p className="small">Something went wrong while loading it. Your points are safe.</p>
        <button className="primary" onClick={() => this.setState({ error: null })}>Try again</button>
        <button className="ghost" onClick={() => { window.location.href = "/"; }}>Go home</button>
      </div>
    );
  }
}
