import { useEffect, useState } from "react";
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const navy = "#070B14";
const lime = "#E7FF4D";
const cyan = "#3DFFE8";
const ink = "#F4F7FB";

function useBrandFont() {
  const [handle] = useState(() => delayRender("Barlow Condensed"));
  useEffect(() => {
    const face = new FontFace("BarlowCondensed", `url(${staticFile("v2/BarlowCondensed-BlackItalic.ttf")})`, {
      weight: "900",
      style: "italic",
    });
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [handle]);
}

function rise(frame: number, from: number, to: number) {
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
}

export const BotDescription = () => {
  useBrandFont();
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const reveal = rise(frame, 16, 46);
  const leave = rise(frame, 78, 96);
  const scoreIn = rise(frame, 90, 108);
  const scoreOut = rise(frame, 142, 162);
  const logo = reveal * (1 - leave);
  const score = scoreIn * (1 - scoreOut);
  const markOn = 1 - score;
  const glow = 0.62 + 0.38 * Math.cos((frame / durationInFrames) * Math.PI * 2);
  const markSize = 168;
  const restX = (width - markSize) / 2;
  const logoX = 28;
  const markX = restX + (logoX - restX) * logo;
  const markY = (height - markSize) / 2;

  return (
    <AbsoluteFill style={{ background: navy, overflow: "hidden", fontFamily: "BarlowCondensed, Impact, sans-serif" }}>
      <Img
        src={staticFile("v2/stadium-wide.jpg")}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.12) brightness(0.72)" }}
      />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(7,11,20,0.35), rgba(7,11,20,0.55) 70%)" }} />
      <div
        style={{
          position: "absolute",
          left: markX - 24,
          top: markY - 24,
          width: markSize + 48,
          height: markSize + 48,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(61,255,232,${0.35 * glow}) 0%, rgba(231,255,77,0.12) 42%, transparent 70%)`,
          opacity: markOn,
          filter: "blur(2px)",
        }}
      />
      <Img
        src={staticFile("v2/mark.png")}
        style={{
          position: "absolute",
          left: markX,
          top: markY,
          width: markSize,
          height: "auto",
          opacity: markOn,
          filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.45))",
        }}
      />
      <Img
        src={staticFile("v2/wordmark.png")}
        style={{
          position: "absolute",
          left: 214,
          top: (height - 118) / 2,
          width: 400,
          height: "auto",
          opacity: logo,
          transform: `translateX(${(1 - logo) * 28}px)`,
          filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.45))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 36,
          top: 54,
          width: 568,
          height: 252,
          borderRadius: 28,
          opacity: score,
          transform: `scale(${0.96 + score * 0.04})`,
          background: "linear-gradient(160deg, rgba(255,255,255,0.16), rgba(12,18,32,0.72))",
          border: "1px solid rgba(61,255,232,0.45)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.4), 0 0 32px rgba(61,255,232,0.16)",
          overflow: "hidden",
          padding: "22px 28px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#FF5D7A", letterSpacing: "0.18em", fontSize: 18, fontWeight: 700 }}>LIVE</div>
          <div style={{ color: cyan, letterSpacing: "0.14em", fontSize: 16 }}>12.4 OV</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
          <div>
            <div style={{ color: ink, fontSize: 22, letterSpacing: "0.08em" }}>IND</div>
            <div style={{ color: lime, fontSize: 92, lineHeight: 0.84, fontStyle: "italic", fontWeight: 900, textShadow: "0 0 18px rgba(231,255,77,0.35)" }}>
              184/3
            </div>
          </div>
          <div style={{ textAlign: "right", color: ink }}>
            <div style={{ fontSize: 28, fontStyle: "italic", fontWeight: 900 }}>NEED 47</div>
            <div style={{ color: cyan, fontSize: 22, marginTop: 4 }}>FROM 28</div>
          </div>
        </div>
        <div style={{ marginTop: 16, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
          <div style={{ width: `${62 + score * 8}%`, height: "100%", background: `linear-gradient(90deg, ${cyan}, ${lime})` }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
