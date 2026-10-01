import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, bootTelegram, inTelegram, t, type Me } from "./lib";
import { Home } from "./screens/Home";
import { MatchPage } from "./screens/Match";
import { PredictPage } from "./screens/Predict";
import { BoardPage } from "./screens/Board";
import { RewardsPage } from "./screens/Rewards";
import { AlertsPage } from "./screens/Alerts";
import { BuddyPage } from "./screens/Buddy";
import { CreateCampaign, Dash, Fulfilment, Users } from "./screens/Admin";
import { AdvertisePage, AgeGate, Gate } from "./screens/Gate";
import { PlayPage } from "./screens/Play";
import { PassPage } from "./screens/Pass";
import { AvatarBuilder } from "./screens/AvatarBuilder";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const lang = me?.user.language || "en";

  useEffect(() => {
    bootTelegram();
    if (!inTelegram()) {
      setLoading(false);
      return;
    }
    api<Me>("/api/me").then(setMe).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  if (!inTelegram()) return <Gate mode="outside" />;
  if (loading) return <div className="app"><div className="skel" /><div className="skel" /><div className="skel" /></div>;
  if (err && !me) return <Gate mode="error" message={err} />;
  if (me?.user.blocked) return <Gate mode="blocked" />;
  if (me && !me.user.registered) return <Gate mode="register" me={me} onDone={setMe} />;
  if (me?.user.needsAge) return <AgeGate me={me} onDone={setMe} />;

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home me={me!} />} />
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
        <Route path="/admin/new" element={<CreateCampaign />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/fulfilment" element={<Fulfilment />} />
      </Routes>
      <Nav lang={lang} admin={!!me?.user.admin} />
    </div>
  );
}

function Nav({ lang, admin }: { lang: string; admin: boolean }) {
  const nav = useNavigate();
  const item = (to: string, key: "home" | "live" | "predict" | "rewards" | "alerts", live?: boolean) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? "on" : "")} onClick={() => live && nav("/match/demo_ind_aus")}>
      <span>{t(lang, key)}</span>
    </NavLink>
  );
  return (
    <nav className="nav">
      {item("/", "home")}
      <NavLink to="/match/demo_ind_aus">{t(lang, "live")}</NavLink>
      {item("/predict", "predict")}
      {item("/rewards", "rewards")}
      {item("/alerts", "alerts")}
      {admin ? null : null}
    </nav>
  );
}
