import { useEffect, useState, type ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const navy = "#070B14";
const lime = "#E7FF4D";
const cyan = "#3DFFE8";
const ink = "#F4F7FB";

type Mode = "tall" | "wide" | "square";

function useBrandFont() {
  const [handle] = useState(() => delayRender("Barlow Condensed"));
  useEffect(() => {
    const face = new FontFace(
      "BarlowCondensed",
      `url(${staticFile("v2/BarlowCondensed-BlackItalic.ttf")})`,
      { weight: "900", style: "italic" },
    );
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [handle]);
}

function modeOf(width: number, height: number): Mode {
  const ratio = width / height;
  if (ratio > 1.2) return "wide";
  if (ratio > 0.9) return "square";
  return "tall";
}

function Stadium() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const mode = modeOf(width, height);
  const src = mode === "wide" ? "v2/stadium-wide.jpg" : mode === "square" ? "v2/stadium-square.jpg" : "v2/stadium-tall.jpg";
  const drift = interpolate(frame, [0, 1680], [1.08, 1], { extrapolateRight: "clamp" });
  const pan = interpolate(frame, [0, 1680], [-18, 18]);
  return (
    <AbsoluteFill style={{ background: navy, overflow: "hidden" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${drift}) translateX(${pan}px)`,
          filter: "saturate(1.15) contrast(1.05)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(7,11,20,0.2) 0%, rgba(7,11,20,0.15) 40%, rgba(7,11,20,0.82) 100%)",
        }}
      />
    </AbsoluteFill>
  );
}

function Beams() {
  const frame = useCurrentFrame();
  const beams = [
    { left: "8%", color: "rgba(231,255,77,0.16)", rot: -18 },
    { left: "38%", color: "rgba(61,255,232,0.14)", rot: 8 },
    { left: "68%", color: "rgba(255,255,255,0.1)", rot: 22 },
  ];
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {beams.map((beam, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: beam.left,
            top: "-15%",
            width: 160,
            height: "140%",
            background: `linear-gradient(180deg, transparent, ${beam.color}, transparent)`,
            transform: `rotate(${beam.rot + Math.sin((frame + i * 40) / 48) * 3}deg)`,
            filter: "blur(6px)",
            mixBlendMode: "screen",
          }}
        />
      ))}
    </AbsoluteFill>
  );
}

function Particles() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dots = new Array(42).fill(0);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {dots.map((_, i) => {
        const x = ((i * 97) % 100) / 100 * width;
        const baseY = ((i * 53) % 100) / 100 * height;
        const y = (baseY - frame * (0.35 + (i % 5) * 0.12) + height) % height;
        const size = 2 + (i % 4);
        const color = i % 5 === 0 ? lime : i % 3 === 0 ? "#FF7A18" : cyan;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: 99,
              background: color,
              opacity: 0.35 + (i % 4) * 0.12,
              boxShadow: `0 0 ${8 + size}px ${color}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function fitSize(text: string, size: number, maxWidth: number, caps: boolean) {
  const unit = caps ? 0.47 : 0.52;
  const natural = Math.max(1, text.length) * size * unit;
  if (natural <= maxWidth) return size;
  return Math.max(26, Math.floor((size * maxWidth) / natural));
}

function Kinetic({
  text,
  size,
  color = lime,
  delay = 0,
  tracking = true,
  caps = true,
  maxWidth,
}: {
  text: string;
  size: number;
  color?: string;
  delay?: number;
  tracking?: boolean;
  caps?: boolean;
  maxWidth: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 140, mass: 0.55 } });
  const shift = tracking ? interpolate(enter, [0, 1], [0.04, caps ? -0.02 : 0]) : 0;
  const fitted = fitSize(text, size, maxWidth, caps);
  return (
    <div
      style={{
        fontFamily: "BarlowCondensed, Impact, sans-serif",
        fontStyle: "italic",
        fontWeight: 900,
        fontSize: fitted,
        lineHeight: 0.92,
        color,
        letterSpacing: `${shift}em`,
        textTransform: caps ? "uppercase" : "none",
        textShadow: "0 10px 40px rgba(0,0,0,0.55)",
        transform: `translateY(${(1 - enter) * 36}px)`,
        opacity: Math.min(1, Math.max(0, enter)),
        whiteSpace: "nowrap",
        maxWidth,
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      {text}
    </div>
  );
}

function fade(frame: number, duration: number, fadeIn = 12, fadeOut = 14) {
  const inn = interpolate(frame, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (fadeOut <= 0) return inn;
  const out = interpolate(frame, [duration - fadeOut, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return Math.min(inn, out);
}

function Scene({
  from,
  duration,
  children,
  fadeOut = 14,
}: {
  from: number;
  duration: number;
  children: ReactNode;
  fadeOut?: number;
}) {
  return (
    <Sequence from={from} durationInFrames={duration}>
      <SceneBody duration={duration} fadeOut={fadeOut}>{children}</SceneBody>
    </Sequence>
  );
}

function SceneBody({ duration, children, fadeOut }: { duration: number; children: ReactNode; fadeOut: number }) {
  const frame = useCurrentFrame();
  const opacity = fade(frame, duration, 12, fadeOut);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Phone({ src, width }: { src: string; width: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 90, mass: 0.7 } });
  const tilt = interpolate(enter, [0, 1], [14, 3]);
  const height = Math.round(width * 1.72);
  const pan = Math.sin(frame / 32) * Math.round(width * 0.028);
  const bezel = Math.max(8, Math.round(width * 0.018));
  return (
    <div
      style={{
        width,
        height,
        borderRadius: width * 0.09,
        padding: bezel,
        background: "linear-gradient(160deg, rgba(255,255,255,0.55), rgba(255,255,255,0.08) 42%, rgba(61,255,232,0.28))",
        boxShadow: "0 36px 90px rgba(0,0,0,0.55), 0 0 64px rgba(61,255,232,0.32), inset 0 0 0 1px rgba(255,255,255,0.28)",
        transform: `perspective(1200px) rotateY(${tilt}deg) rotateX(5deg) scale(${0.94 + enter * 0.06})`,
        opacity: enter,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: width * 0.072,
          overflow: "hidden",
          background: navy,
          position: "relative",
          boxShadow: "inset 0 0 42px rgba(61,255,232,0.28), inset 0 0 16px rgba(231,255,77,0.16)",
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            position: "absolute",
            left: "-4%",
            top: "-6%",
            width: "108%",
            height: "118%",
            objectFit: "cover",
            objectPosition: "center top",
            transform: `translateY(${pan}px)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(180deg, rgba(61,255,232,0.2) 0%, rgba(231,255,77,0.05) 18%, transparent 42%, transparent 80%, rgba(7,11,20,0.35) 100%)",
            mixBlendMode: "screen",
          }}
        />
      </div>
    </div>
  );
}

function Stage({
  title,
  sub,
  screen,
  mascot,
}: {
  title: string;
  sub?: string;
  screen?: string;
  mascot?: string;
  mascotSide?: "left" | "right";
}) {
  const { width, height } = useVideoConfig();
  const mode = modeOf(width, height);
  const titleSize = mode === "tall" ? 108 : mode === "square" ? 72 : 96;
  const phoneW = mode === "tall" ? 560 : mode === "square" ? 360 : 380;
  const copyWidth = mode === "tall" ? width - 160 : mode === "square" ? 400 : 680;
  const copy = (
    <div style={{ textAlign: mode === "tall" ? "center" : "left", width: copyWidth, maxWidth: "100%" }}>
      <Kinetic text={title} size={titleSize} maxWidth={copyWidth} />
      {sub && (
        <div style={{ marginTop: 12 }}>
          <Kinetic text={sub} size={Math.round(titleSize * 0.42)} color={cyan} delay={6} maxWidth={copyWidth} />
        </div>
      )}
    </div>
  );
  if (mode === "tall") {
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", top: 108, left: 80, right: 80, textAlign: "center" }}>{copy}</div>
        {screen && (
          <div style={{ position: "absolute", top: 380, left: (width - phoneW) / 2 }}>
            <Phone src={screen} width={phoneW} />
          </div>
        )}
        {mascot && (
          <Img
            src={staticFile(mascot)}
            style={{ position: "absolute", right: 28, bottom: 36, width: 230, height: "auto", filter: "drop-shadow(0 16px 18px rgba(0,0,0,0.5))" }}
          />
        )}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 80, top: 0, bottom: 0, width: copyWidth, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {copy}
        {mascot && (
          <Img src={staticFile(mascot)} style={{ width: mode === "square" ? 180 : 240, height: "auto", marginTop: 28, filter: "drop-shadow(0 16px 18px rgba(0,0,0,0.5))" }} />
        )}
      </div>
      {screen && (
        <div style={{ position: "absolute", right: 72, top: (height - Math.round(phoneW * 1.72)) / 2 }}>
          <Phone src={screen} width={phoneW} />
        </div>
      )}
    </AbsoluteFill>
  );
}

function LogoReveal() {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const mode = modeOf(width, height);
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 120, mass: 0.7 } });
  const mark = mode === "tall" ? 460 : mode === "square" ? 280 : 340;
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
      <div style={{ position: "relative", transform: `scale(${0.72 + pop * 0.28})`, opacity: pop }}>
        <div
          style={{
            position: "absolute",
            inset: -40,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(61,255,232,0.45), rgba(231,255,77,0.12) 45%, transparent 70%)",
            filter: "blur(8px)",
          }}
        />
        <Img src={staticFile("v2/mark.png")} style={{ width: mark, height: "auto", position: "relative" }} />
      </div>
      <Img
        src={staticFile("v2/wordmark.png")}
        style={{
          width: Math.min(mode === "tall" ? 820 : mode === "square" ? 620 : 700, width - 180),
          height: "auto",
          transform: `translateY(${(1 - pop) * 30}px)`,
          opacity: pop,
          filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.45))",
        }}
      />
      <Img
        src={staticFile("v2/lino-cheer.png")}
        style={{
          position: "absolute",
          right: mode === "wide" ? 80 : 24,
          bottom: mode === "tall" ? 80 : 24,
          width: mode === "tall" ? 340 : 240,
          height: "auto",
          transform: `translateY(${(1 - pop) * 80}px)`,
          opacity: pop,
          filter: "drop-shadow(0 16px 20px rgba(0,0,0,0.5))",
        }}
      />
    </AbsoluteFill>
  );
}

function EndCard() {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const mode = modeOf(width, height);
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const cta = mode === "wide" ? 78 : mode === "square" ? 58 : 72;
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "48px 80px" }}>
      <Img src={staticFile("v2/mark.png")} style={{ width: mode === "tall" ? 260 : 170, height: "auto", transform: `scale(${pop})` }} />
      <Img src={staticFile("v2/wordmark.png")} style={{ width: Math.min(mode === "tall" ? 760 : 540, width - 180), height: "auto", opacity: pop }} />
      <div style={{ marginTop: 12, textAlign: "center", width: width - 180 }}>
        <Kinetic text="Open @LiveLineProBot" size={cta} caps={false} maxWidth={width - 180} />
        <div style={{ marginTop: 16 }}>
          <Kinetic text="t.me/LiveLine_Pro" size={Math.round(cta * 0.62)} color={cyan} delay={6} caps={false} maxWidth={width - 180} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Flash() {
  const frame = useCurrentFrame();
  const hit = 8.55 * 60;
  const opacity = interpolate(frame, [hit, hit + 3, hit + 10], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#F4F7FB", opacity, pointerEvents: "none" }} />;
}

export const Promo = () => {
  useBrandFont();
  const { width } = useVideoConfig();
  const title = modeSize();
  return (
    <AbsoluteFill style={{ background: navy, color: ink, fontFamily: "BarlowCondensed, Impact, sans-serif" }}>
      <Stadium />
      <Beams />
      <Particles />
      <Audio src={staticFile("v2/bed.mp3")} />
      <Scene from={0} duration={170}>
        <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", width: width - 160 }}>
            <Kinetic text="Tonight" size={title} maxWidth={width - 160} />
            <div style={{ marginTop: 8 }}>
              <Kinetic text="Under the lights" size={Math.round(title * 0.42)} color={ink} delay={8} maxWidth={width - 160} />
            </div>
          </div>
        </AbsoluteFill>
      </Scene>
      <Scene from={148} duration={270}>
        <LogoReveal />
      </Scene>
      <Scene from={390} duration={270}>
        <Stage title="Ball by ball" sub="The live line" screen="v2/screens/live.png" mascot="v2/lino-bat.png" />
      </Scene>
      <Scene from={630} duration={260}>
        <Stage title="Next ball" sub="Free points" screen="v2/screens/predict.png" />
      </Scene>
      <Scene from={860} duration={250}>
        <Stage title="Spin" sub="A free turn" screen="v2/screens/wheel.png" />
      </Scene>
      <Scene from={1080} duration={230}>
        <Stage title="The board" sub="Season points" screen="v2/screens/board.png" />
      </Scene>
      <Scene from={1280} duration={210}>
        <Stage title="Ask Lino" sub="Your AI buddy" screen="v2/screens/ai.png" mascot="v2/lino-think.png" mascotSide="left" />
      </Scene>
      <Scene from={1460} duration={220} fadeOut={0}>
        <EndCard />
      </Scene>
      <Flash />
    </AbsoluteFill>
  );
};

function modeSize() {
  const { width, height } = useVideoConfig();
  const mode = modeOf(width, height);
  if (mode === "tall") return 168;
  if (mode === "square") return 112;
  return 140;
}
