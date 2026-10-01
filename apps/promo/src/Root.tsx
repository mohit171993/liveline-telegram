import { Composition } from "remotion";
import { BotDescription } from "./BotDescription";
import { Promo } from "./Promo";

const FPS = 60;
const DURATION = 28 * FPS;

export const RemotionRoot = () => {
  return (
    <>
      <Composition id="PromoVertical" component={Promo} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
      <Composition id="PromoWide" component={Promo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="PromoSquare" component={Promo} durationInFrames={DURATION} fps={FPS} width={1080} height={1080} />
      <Composition id="BotDescription" component={BotDescription} durationInFrames={180} fps={30} width={640} height={360} />
    </>
  );
};
