import { useEffect, useRef } from "react";
import { haptic } from "../lib";
import { AdSlot } from "./Ad";
import { MOMENT_STICKER } from "../Avatar";
import { Lottie } from "lottie-react";
import { Mascot } from "../brand/Brand";
import { mascotLottie } from "../brand/motion";

const COPY: Record<string, { en: string; hi: string }> = {
  FOUR: { en: "FOUR", hi: "चौका" },
  SIX: { en: "SIX", hi: "छक्का" },
  WICKET: { en: "WICKET", hi: "विकेट" },
  FIFTY: { en: "FIFTY", hi: "फिफ्टी" },
  HUNDRED: { en: "HUNDRED", hi: "शतक" },
  WIN: { en: "WON", hi: "जीत" },
};

export function muted(): boolean {
  return localStorage.getItem("ll-mute") === "1";
}

export function setMuted(value: boolean) {
  localStorage.setItem("ll-mute", value ? "1" : "0");
}

function roar() {
  if (muted()) return;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  let ctx: AudioContext;
  try { ctx = new Ctx(); } catch { return; }
  const length = Math.floor(ctx.sampleRate * 0.7);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const fade = Math.pow(1 - i / length, 1.3);
    data[i] = (Math.random() * 2 - 1) * fade;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 380;
  const gain = ctx.createGain();
  gain.gain.value = 0.22;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start();
  src.onended = () => void ctx.close();
}

export function Celebrate({ moment, lang, matchKey, onDone }: { moment: string; lang: string; matchKey?: string; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    haptic(moment === "WICKET" || moment === "WIN" || moment === "HUNDRED" ? "heavy" : "medium");
    if (moment === "FIFTY" || moment === "HUNDRED" || moment === "WIN") {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
    }
    roar();
    const node = canvas.current;
    if (!node || reduce) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      node.width = window.innerWidth;
      node.height = window.innerHeight;
    };
    draw();
    const colors = moment === "WICKET" ? ["#ff5d7a", "#ffffff"] : moment === "WIN" ? ["#e7ff4d", "#ff7a18", "#8ee7ff"] : ["#e7ff4d", "#3ee0c5", "#ffffff"];
    const bits = Array.from({ length: 70 }, () => ({
      x: Math.random() * node.width,
      y: -20 - Math.random() * node.height * 0.4,
      r: 3 + Math.random() * 4,
      v: 2 + Math.random() * 3.2,
      c: colors[Math.floor(Math.random() * colors.length)],
      w: Math.random() * 2,
    }));
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      ctx.clearRect(0, 0, node.width, node.height);
      for (const bit of bits) {
        bit.y += bit.v;
        bit.x += Math.sin(bit.y / 24) * bit.w;
        ctx.fillStyle = bit.c;
        ctx.fillRect(bit.x, bit.y, bit.r, bit.r * 0.6);
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [moment, reduce]);

  const label = COPY[moment]?.[lang === "hi" ? "hi" : "en"] || moment;
  return (
    <div className="moment" role="dialog" aria-live="assertive" aria-label={label}>
      <canvas ref={canvas} className="confetti" aria-hidden="true" />
      <div className="moment-card">
        <Mascot mood={moment} size={96} />
        {!reduce && <Lottie className="moment-lottie" src={mascotLottie} loop />}
        <strong>{MOMENT_STICKER[moment] || "✨"} {label}</strong>
        <AdSlot slot="celebration" matchKey={matchKey} />
        <button className="ghost" onClick={onDone}>Skip</button>
      </div>
    </div>
  );
}
