import { useEffect, useState } from "react";
import { api } from "../lib";

export function AdSlot({ slot, matchKey }: { slot: string; matchKey?: string }) {
  const [ad, setAd] = useState<any>(null);
  useEffect(() => {
    const q = new URLSearchParams({ slot, ...(matchKey ? { matchKey } : {}) });
    api<{ ad: any }>(`/api/ads/slot?${q}`).then(async (res) => {
      setAd(res.ad);
      if (res.ad) await api(`/api/ads/${res.ad.id}/impression`, { method: "POST" }).catch(() => undefined);
    }).catch(() => undefined);
  }, [slot, matchKey]);
  if (!ad) return null;
  return (
    <button className="ad" onClick={async () => {
      await api(`/api/ads/${ad.id}/click`, { method: "POST" }).catch(() => undefined);
      if (ad.clickUrl) window.Telegram?.WebApp?.openLink?.(ad.clickUrl);
    }}>
      <div>
        <small>Sponsored</small>
        <b className="block">{ad.headline}</b>
        <span className="small">{ad.body}</span>
      </div>
      <span className="points">{ad.cta}</span>
    </button>
  );
}
