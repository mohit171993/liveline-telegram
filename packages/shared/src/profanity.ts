const WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "dick", "piss",
  "madarchod", "bhenchod", "behenchod", "chutiya", "chuthiya", "gandu", "randi", "harami",
  "मादरचोद", "भेनचोद", "बहनचोद", "चूतिया", "गांडू", "रंडी",
];

const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${WORDS.map(escapeReg).join("|")})(?=$|[^\\p{L}\\p{N}])`, "giu");

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsProfanity(text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text || "");
}

export function maskProfanity(text: string): string {
  return (text || "").replace(pattern, (_m, pre: string) => `${pre}•••`);
}
