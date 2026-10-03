export interface DeliveryFact {
  runs: number;
  batRuns: number;
  extra: number;
  extraType?: string;
  wicket: boolean;
}

export type BallPick = "dot" | "1" | "2" | "3" | "4" | "6" | "wicket" | "extra";

export function classifyDelivery(ball: DeliveryFact): BallPick {
  if (ball.wicket) return "wicket";
  if (ball.extraType === "wd" || ball.extraType === "nb") return "extra";
  if (ball.batRuns >= 6) return "6";
  if (ball.batRuns === 4) return "4";
  if (ball.batRuns === 3) return "3";
  if (ball.batRuns === 2) return "2";
  if (ball.batRuns === 1) return "1";
  return "dot";
}

export function settleBallPick(
  pick: string,
  ball: DeliveryFact,
): { correct: boolean; points: number; actual: string } {
  const actual = classifyDelivery(ball);
  if (pick === actual) {
    const points = actual === "wicket" || actual === "6" ? 25 : actual === "4" ? 20 : 12;
    return { correct: true, points, actual };
  }
  const family = (value: string) => {
    if (value === "wicket") return "w";
    if (value === "4" || value === "6") return "boundary";
    if (value === "dot") return "dot";
    if (value === "extra") return "extra";
    return "run";
  };
  if (family(pick) === family(actual) && family(pick) !== "run") {
    return { correct: true, points: 6, actual };
  }
  return { correct: false, points: 0, actual };
}

export function settleOverPick(
  pick: string,
  overRuns: number,
): { correct: boolean; points: number; actual: string } {
  const guessed = Number(pick);
  if (!Number.isFinite(guessed)) return { correct: false, points: 0, actual: String(overRuns) };
  const delta = Math.abs(guessed - overRuns);
  if (delta === 0) return { correct: true, points: 20, actual: String(overRuns) };
  if (delta <= 2) return { correct: true, points: 8, actual: String(overRuns) };
  return { correct: false, points: 0, actual: String(overRuns) };
}

export function settleMatchPick(
  pick: string,
  winner: "a" | "b" | "tie",
): { correct: boolean; points: number; actual: string } {
  const correct = pick === winner;
  return { correct, points: correct ? 50 : 0, actual: winner };
}

/** Server-side lock: the ball must still be in the future by `lockMs`. */
export function predictionWindowOpen(nowMs: number, nextBallAt: number, lockMs: number): boolean {
  return nowMs + lockMs < nextBallAt;
}

export function applyBoost(points: number, boosts: number): { points: number; boostsLeft: number } {
  if (points <= 0 || boosts <= 0) return { points, boostsLeft: boosts };
  return { points: points * 2, boostsLeft: boosts - 1 };
}
