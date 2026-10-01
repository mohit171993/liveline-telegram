import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const navy = "#070B14";
const lime = "#E7FF4D";
const cyan = "#3DFFE8";
const ink = "#F4F7FB";

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <defs>
        <linearGradient id="bg" x1="6" y1="2" x2="60" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A2C4E" />
          <stop offset="1" stopColor="#070B14" />
        </linearGradient>
        <linearGradient id="pulse" x1="6" y1="36" x2="58" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3DFFE8" />
          <stop offset="0.55" stopColor="#E7FF4D" />
          <stop offset="1" stopColor="#FF7A18" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#bg)" />
      <circle cx="32" cy="32" r="15.5" fill="#0C1424" stroke="#F4F7FB" strokeWidth="3" />
      <path d="M23.5 24.5c2.2-3.2 5.4-4.8 8.5-4.8M40.5 40.5c-2.2 3.2-5.4 4.8-8.5 4.8" fill="none" stroke="#3DFFE8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7 34.5h11.5l6.2-11 8.4 20.5 6.4-13H57" fill="none" stroke="url(#pulse)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Caption({ text, sub }: { text: string; sub?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  return (
    <div style={{ transform: `translateY(${(1 - enter) * 40}px)`, opacity: enter, textAlign: "center", padding: "0 64px" }}>
      <div style={{ fontFamily: "Impact, Arial Black, sans-serif", fontSize: 92, letterSpacing: 1, color: lime, lineHeight: 0.95 }}>{text}</div>
      {sub && <div style={{ marginTop: 16, fontFamily: "Arial, sans-serif", fontSize: 36, color: ink, letterSpacing: 2 }}>{sub}</div>}
    </div>
  );
}

function Phone({ src }: { src: string }) {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 150], [1.04, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ width: 760, height: 1180, borderRadius: 54, overflow: "hidden", border: "10px solid #F4F7FB", boxShadow: `0 40px 90px rgba(0,0,0,.45), 0 0 0 1px ${cyan}` }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", transform: `scale(${drift})` }} />
    </div>
  );
}

export const Promo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: navy, color: ink, fontFamily: "Arial, sans-serif" }}>
      <AbsoluteFill style={{ background: "radial-gradient(700px 500px at 50% 30%, rgba(231,255,77,0.2), transparent 60%)" }} />
      <Sequence durationInFrames={120}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28 }}>
          <div style={{ transform: `scale(${0.6 + pop * 0.4})` }}><Mark size={280} /></div>
          <Caption text="Fastest Live Line" sub="Ball by ball. In Telegram." />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={120} durationInFrames={165}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28 }}>
          <Caption text="Fastest Live Line" />
          <Phone src="home.png" />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={285} durationInFrames={165}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28 }}>
          <Caption text="Predict & Win Free Rewards" sub="Points only. No betting." />
          <Phone src="match.png" />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
