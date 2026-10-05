import { useEffect, useState } from "react";
import { Lottie } from "lottie-react";
import { mascotLottie, splashLottie } from "./motion";

export type ThemeName = "light" | "dark";

export function applyTheme(mode: ThemeName) {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem("ll-theme", mode);
  const bg = mode === "dark" ? "#070B14" : "#F3F6FB";
  window.Telegram?.WebApp?.setHeaderColor?.(bg);
  window.Telegram?.WebApp?.setBackgroundColor?.(bg);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", bg);
}

export function initialTheme(): ThemeName {
  const saved = localStorage.getItem("ll-theme");
  if (saved === "light" || saved === "dark") return saved;
  const scheme = window.Telegram?.WebApp?.colorScheme;
  if (scheme === "light" || scheme === "dark") return scheme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }
  return { theme, toggle };
}

export function Mark({ size = 36, theme = "dark" }: { size?: number; theme?: ThemeName }) {
  return <img className="mark" src={theme === "light" ? "/brand/icon-light.svg" : "/brand/icon.svg"} width={size} height={size} alt="" />;
}

export function Wordmark({ theme = "dark" }: { theme?: ThemeName }) {
  return (
    <span className="brand">
      <Mark size={34} theme={theme} />
      <span><b className="name">LIVELINE</b><span className="sub">Pro</span></span>
    </span>
  );
}

export function Mascot({ mood = "idle", size = 88 }: { mood?: string; size?: number }) {
  return <img className={`mascot ${mood}`} src="/brand/mascot.svg" width={size} height={size} alt="" />;
}

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, reduce ? 450 : 1700);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="splash" role="dialog" aria-label="LiveLine Pro">
      {reduce ? <Mark size={96} /> : <Lottie className="splash-lottie" src={splashLottie} loop />}
      <img className="splash-logo" src="/brand/logo.svg" alt="LiveLine Pro" />
      <Mascot mood="cheer" size={72} />
    </div>
  );
}
