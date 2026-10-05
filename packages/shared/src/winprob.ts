export interface WinProb {
  a: number;
  b: number;
  tie: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Our own win model from match state. This is not a betting price.
 * Chase side uses required rate against a wicket-adjusted scoring capacity.
 * First innings uses projected total against a format par.
 */
export function winProbability(input: {
  batting: "a" | "b";
  innings: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  maxOvers: number;
  target: number | null;
  format: string;
}): WinProb {
  const ballsLeft = Math.max(0, input.maxOvers * 6 - input.legalBalls);
  const wicketsLeft = Math.max(0, 10 - input.wickets);
  let pBat = 0.5;

  if (input.target && input.innings >= 2) {
    const need = input.target - input.runs;
    if (need <= 0) pBat = 0.99;
    else if (ballsLeft <= 0 || wicketsLeft <= 0) pBat = 0.02;
    else {
      const required = need / ballsLeft;
      const capacity = 1.05 + wicketsLeft * 0.09;
      const pressure = (capacity - required) * 5.1 + (wicketsLeft - 4) * 0.08;
      const death = ballsLeft < 12 ? (required - 1.6) * 0.4 : 0;
      pBat = clamp(logistic(pressure - death), 0.03, 0.97);
    }
  } else {
    const par = input.format === "ODI" ? 280 : input.format === "TEST" ? 350 : 175;
    const oversBowled = Math.max(0.2, input.legalBalls / 6);
    const projected = (input.runs / oversBowled) * input.maxOvers;
    const wicketPenalty = input.wickets * 4;
    pBat = clamp(logistic((projected - wicketPenalty - par) / 22), 0.08, 0.92);
  }

  const tie = input.target ? 0.01 : 0;
  const pBowl = clamp(1 - pBat - tie, 0.01, 0.98);
  const a = input.batting === "a" ? pBat : pBowl;
  const b = input.batting === "b" ? pBat : pBowl;
  const sum = a + b + tie;
  return {
    a: Math.round((a / sum) * 1000) / 10,
    b: Math.round((b / sum) * 1000) / 10,
    tie: Math.round((tie / sum) * 1000) / 10,
  };
}

export function currentRunRate(runs: number, legalBalls: number): number {
  if (legalBalls <= 0) return 0;
  return Math.round((runs / (legalBalls / 6)) * 100) / 100;
}

export function requiredRunRate(
  target: number | null,
  runs: number,
  legalBalls: number,
  maxOvers: number,
): number | null {
  if (!target) return null;
  const ballsLeft = maxOvers * 6 - legalBalls;
  if (ballsLeft <= 0) return null;
  const need = target - runs;
  if (need <= 0) return 0;
  return Math.round((need / (ballsLeft / 6)) * 100) / 100;
}

export function projectedScore(runs: number, legalBalls: number, maxOvers: number, chasing: boolean): number | null {
  if (chasing || legalBalls <= 0) return null;
  return Math.round((runs / (legalBalls / 6)) * maxOvers);
}

export function oversLabel(legalBalls: number): string {
  const over = Math.floor(legalBalls / 6);
  const ball = legalBalls % 6;
  return `${over}.${ball}`;
}
