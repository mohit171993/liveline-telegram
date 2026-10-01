import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, bootTelegram, inTelegram, type Me } from "./lib";
import { Home } from "./screens/Home";
import { MatchPage } from "./screens/Match";
import { PredictPage } from "./screens/Predict";
import { BoardPage } from "./screens/Board";
import { RewardsPage } from "./screens/Rewards";
import { AlertsPage } from "./screens/Alerts";
import { BuddyPage } from "./screens/Buddy";
import { Admins, CreateCampaign, Dash, Fulfilment, Users } from "./screens/Admin";
import { Reports } from "./screens/Reports";
import { AdvertisePage, AgeGate, Gate } from "./screens/Gate";
import { PlayPage } from "./screens/Play";
import { PassPage } from "./screens/Pass";
import { AvatarBuilder } from "./screens/AvatarBuilder";
import { Splash } from "./brand/Brand";
import { AppHeader, ErrorBoundary, TabBar, Toaster } from "./ui";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [splash, setSplash] = useState(true);
  const lang = me?.user.language === "hi" ? "hi" : "en";

  useEffect(() => {
    bootTelegram();
    if (!inTelegram()) {
      setLoading(false);
      return;
    }
    api<Me>("/api/me").then(setMe).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  // Points pill stays current: refresh the profile after any successful action.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (event: Event) => {
      if ((event as CustomEvent<{ kind: string }>).detail?.kind !== "ok") return;
      clearTimeout(timer);
      timer = setTimeout(() => { api<Me>("/api/me").then(setMe).catch(() => undefined); }, 600);
    };
    window.addEventListener("ll-toast", on);
    return () => { window.removeEventListener("ll-toast", on); clearTimeout(timer); };
  }, []);

  // Deep link: t.me/LiveLineProBot?startapp=match_<key> opens that match.
  const nav = useNavigate();
  const location = useLocation();
  const ready = Boolean(me?.user.registered && !me?.user.needsAge && !me?.user.blocked);
  useEffect(() => {
    if (!ready) return;
    const param = window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
    // Handle each launch once (keyed by the signed launch), so a later deep link in the same webview still works.
    const launch = `ll:deeplink:${window.Telegram?.WebApp?.initData?.slice(-24) || ""}`;
    if (!param || sessionStorage.getItem(launch)) return;
    const target = deepLinkRoute(param);
    if (target) {
      sessionStorage.setItem(launch, "1");
      nav(target, { replace: true });
    }
  }, [ready, nav]);

  if (!inTelegram()) return <><Gate mode="outside" />{splash && <Splash onDone={() => setSplash(false)} />}</>;
  if (loading) return <div className="app"><div className="skel" /><div className="skel" /><div className="skel" /></div>;
  if (err && !me) return <Gate mode="error" message={err} />;
  if (me?.user.blocked) return <Gate mode="blocked" />;
  if (me && !me.user.registered) return <Gate mode="register" me={me} onDone={setMe} />;
  if (me?.user.needsAge) return <AgeGate me={me} onDone={setMe} />;

  return (
    <div className="app">
      {splash && <Splash onDone={() => setSplash(false)} />}
      <Toaster />
      <AppHeader me={me!} onMe={setMe} />
      <ErrorBoundary resetKey={location.pathname}>
      <Routes>
        <Route path="/" element={<Home me={me!} />} />
        <Route path="/live" element={<LiveRedirect />} />
        <Route path="/match/:key" element={<MatchPage lang={lang} />} />
        <Route path="/predict" element={<PredictPage lang={lang} />} />
        <Route path="/predict/:key" element={<PredictPage lang={lang} />} />
        <Route path="/board" element={<BoardPage lang={lang} me={me!} />} />
        <Route path="/rewards" element={<RewardsPage lang={lang} />} />
        <Route path="/pass" element={<PassPage lang={lang} />} />
        <Route path="/avatar" element={<AvatarBuilder lang={lang} onSaved={(look) => setMe((cur) => cur ? { ...cur, user: { ...cur.user, look } } : cur)} />} />
        <Route path="/play" element={<PlayPage lang={lang} />} />
        <Route path="/alerts" element={<AlertsPage lang={lang} />} />
        <Route path="/ai/:key" element={<BuddyPage lang={lang} />} />
        <Route path="/advertise" element={<AdvertisePage />} />
        <Route path="/admin" element={<Dash />} />
        <Route path="/admin/reports" element={<Reports />} />
        <Route path="/admin/new" element={<CreateCampaign />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/admins" element={<Admins />} />
        <Route path="/admin/fulfilment" element={<Fulfilment />} />
        <Route path="/ai" element={<BuddyPage lang={lang} />} />
        <Route path="*" element={<Home me={me!} />} />
      </Routes>
      </ErrorBoundary>
      <TabBar lang={lang} />
    </div>
  );
}

/** Live tab: open the match in play now, else the next one up, else the most recent. */
function LiveRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    api<{ matches: { key: string; status: string; startAt?: number }[] }>("/api/home")
      .then(({ matches }) => {
        const now = Date.now();
        const pick =
          matches.find((m) => m.status === "live") ||
          [...matches].filter((m) => m.status === "upcoming").sort((a, b) => (a.startAt || 0) - (b.startAt || 0)).find((m) => (m.startAt || 0) >= now - 3600_000) ||
          matches[0];
        nav(pick ? `/match/${pick.key}` : "/", { replace: true });
      })
      .catch(() => nav("/", { replace: true }));
  }, [nav]);
  return <div className="skel" />;
}

/** startapp=<param> from bot buttons and shared links → Mini App screen. */
export function deepLinkRoute(param: string): string | null {
  const routes: Record<string, string> = {
    home: "/",
    live: "/live",
    scores: "/live",
    predict: "/predict",
    spin: "/rewards",
    rewards: "/rewards",
    board: "/board",
    leaderboard: "/board",
    league: "/board",
    alerts: "/alerts",
    reminders: "/alerts",
    lino: "/ai",
    buddy: "/ai",
    ai: "/ai",
    play: "/play",
    puzzle: "/play",
    album: "/play",
    pass: "/pass",
    season: "/pass",
    avatar: "/avatar",
    admin: "/admin",
  };
  if (param.startsWith("match_")) return `/match/${param.slice("match_".length)}`;
  if (param.startsWith("predict_")) return `/predict/${param.slice("predict_".length)}`;
  if (param.startsWith("lino_")) return `/ai/${param.slice("lino_".length)}`;
  return routes[param] || null;
}
