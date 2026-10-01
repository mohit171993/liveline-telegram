import { Composition } from "remotion";
import { Promo } from "./Promo";

const FPS = 60;
const DURATION = 28 * FPS;

export const RemotionRoot = () => {
  return (
    <>
      <Composition id="PromoVertical" component={Promo} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
      <Composition id="PromoWide" component={Promo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="PromoSquare" component={Promo} durationInFrames={DURATION} fps={FPS} width={1080} height={1080} />
    </>
  );
};
