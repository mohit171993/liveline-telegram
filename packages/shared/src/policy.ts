/** India's 2025 online gaming law bans promoting real-money gaming. */
const BETTING =
  /\b(odds|bookmaker|bookie|betting|wager|satta|session\s*rate|bhav|cash\s*out|lay\s*bet|back\s*bet|fancy\s*bet)\b|सट्टा|बुकमेकर|जुआ|सट्टेबाजी|बेटिंग/i;

const OFF_TOPIC =
  /\b(write (me )?code|python script|election|diagnose|prescription|crypto price|bitcoin|stock tip|homework)\b/i;

const SPORTS =
  /cricket|match|score|wicket|over|ball|batter|batsman|bowler|run|six|four|pitch|toss|target|partnership|innings|player|team|stadium|series|win|chase|field|yorker|spinner|auction|squad|xi\b|rate|crr|rrr|projected|live line|लाइव|मैच|विकेट|रन|ओवर|गेंद|खिलाड़ी|टीम|स्कोर|चौका|छक्का|पिच/i;

export function containsBetting(text: string): boolean {
  return BETTING.test(text || "");
}

export function isSportsTalk(text: string): boolean {
  return SPORTS.test(text || "");
}

export function moderationDecision(text: string): "ok" | "betting" | "off_topic" {
  if (containsBetting(text)) return "betting";
  const trimmed = text.trim();
  if (trimmed.length < 4) return "ok";
  if (OFF_TOPIC.test(trimmed) && !isSportsTalk(trimmed)) return "off_topic";
  return "ok";
}

export const BETTING_REFUSAL = {
  en: "I can't help with betting, odds, sessions, or bookmaker rates. Ask me about the score, the chase, or the players.",
  hi: "मैं सट्टेबाजी, ऑड्स, सेशन या बुकमेकर रेट पर मदद नहीं कर सकता। स्कोर, पीछा या खिलाड़ियों के बारे में पूछें।",
};

export const OFF_TOPIC_REFUSAL = {
  en: "I'm the match buddy — cricket and this live line only.",
  hi: "मैं मैच बडी हूँ — सिर्फ़ क्रिकेट और इस लाइव लाइन पर बात करूँगा।",
};
