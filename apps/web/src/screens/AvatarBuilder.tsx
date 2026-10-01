import { useEffect, useState } from "react";
import { api } from "../lib";
import { Avatar, type Look } from "../Avatar";
import { AdSlot } from "./Ad";

type Item = { id: string; xp: number; unlocked: boolean; emoji?: string; color?: string; badge?: string; label?: string; labelHi?: string; icon?: string };

export function AvatarBuilder({ lang, onSaved }: { lang: string; onSaved?: (look: Look) => void }) {
  const [shop, setShop] = useState<any>(null);
  const [pick, setPick] = useState<any>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    api("/api/avatar").then((data) => { setShop(data); setPick(data.pick); }).catch((e) => setNote(e.message));
  }, []);

  if (!shop || !pick) return <div className="skel" />;
  const preview: Look = {
    face: shop.faces.find((f: Item) => f.id === pick.face)?.emoji || "😎",
    jersey: shop.jerseys.find((f: Item) => f.id === pick.jersey)?.color || "#e7ff4d",
    ink: "#142000",
    number: pick.number,
    role: pick.role,
    icon: shop.roles.find((r: Item) => r.id === pick.role)?.icon || "🏏",
    cap: shop.caps.find((f: Item) => f.id === pick.cap)?.emoji || "",
    frame: shop.frames.find((f: Item) => f.id === pick.frame)?.color || "#e7ff4d",
  };

  function choose(group: string, item: Item) {
    if (!item.unlocked) {
      setNote(item.badge ? `Unlocks with ${item.badge.split("_").join(" ")}` : `Needs ${item.xp} XP`);
      return;
    }
    setPick({ ...pick, [group]: item.id });
    setNote("");
  }

  return (
    <>
      <h2>{lang === "hi" ? "अवतार" : "Avatar"}</h2>
      <p className="small">Cartoon kit only. No photos. Pieces unlock with XP and rewards.</p>
      <div className="avatar-stage">
        <Avatar look={preview} size={120} />
      </div>
      <AdSlot slot="avatar" />
      <h2>{lang === "hi" ? "चेहरा" : "Face"}</h2>
      <div className="chips">
        {shop.faces.map((item: Item) => (
          <button key={item.id} className={`chip ${pick.face === item.id ? "on" : ""}`} aria-disabled={!item.unlocked} onClick={() => choose("face", item)}>{item.emoji}{item.unlocked ? "" : " 🔒"}</button>
        ))}
      </div>
      <h2>{lang === "hi" ? "जर्सी" : "Jersey"}</h2>
      <div className="chips">
        {shop.jerseys.map((item: Item) => (
          <button key={item.id} className={`chip ${pick.jersey === item.id ? "on" : ""}`} aria-label={item.id} onClick={() => choose("jersey", item)}>
            <i className="swatch" style={{ background: item.color }} /> {item.unlocked ? item.id : `${item.xp} XP`}
          </button>
        ))}
      </div>
      <h2>{lang === "hi" ? "टोपी" : "Cap"}</h2>
      <div className="chips">
        {shop.caps.map((item: Item) => (
          <button key={item.id} className={`chip ${pick.cap === item.id ? "on" : ""}`} onClick={() => choose("cap", item)}>{item.emoji || "—"}{item.unlocked ? "" : " 🔒"}</button>
        ))}
      </div>
      <h2>{lang === "hi" ? "फ्रेम" : "Frame"}</h2>
      <div className="chips">
        {shop.frames.map((item: Item) => (
          <button key={item.id} className={`chip ${pick.frame === item.id ? "on" : ""}`} onClick={() => choose("frame", item)}>
            <i className="swatch" style={{ background: item.color }} /> {item.unlocked ? item.id : "🔒"}
          </button>
        ))}
      </div>
      <h2>{lang === "hi" ? "भूमिका" : "Role"}</h2>
      <div className="chips">
        {shop.roles.map((item: Item) => (
          <button key={item.id} className={`chip ${pick.role === item.id ? "on" : ""}`} onClick={() => setPick({ ...pick, role: item.id })}>{item.icon} {lang === "hi" ? item.labelHi : item.label}</button>
        ))}
      </div>
      <label className="small" htmlFor="shirt">Shirt number</label>
      <input id="shirt" className="field" inputMode="numeric" value={pick.number} onChange={(e) => setPick({ ...pick, number: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
      <button className="primary" onClick={async () => {
        try {
          const saved = await api<{ look: Look }>("/api/avatar", { method: "POST", body: JSON.stringify(pick) });
          setNote(lang === "hi" ? "सेव हो गया" : "Kit saved");
          onSaved?.(saved.look);
        } catch (err: any) { setNote(err.message); }
      }}>{lang === "hi" ? "सेव" : "Save kit"}</button>
      {note && <p className="small">{note}</p>}
    </>
  );
}
