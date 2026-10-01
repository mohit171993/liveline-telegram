import { prisma } from "@liveline/db";
import { BETTING_REFUSAL, istDay, moderationDecision, OFF_TOPIC_REFUSAL, type MatchView } from "@liveline/shared";
import { env } from "../env";
import { httpError } from "../httpError";

export async function askBuddy(userId: string, language: string, message: string, match: MatchView) {
  const decision = moderationDecision(message);
  const lang = language === "hi" ? "hi" : "en";
  if (decision === "betting") return { text: BETTING_REFUSAL[lang], stub: !env.openaiKey };
  if (decision === "off_topic") return { text: OFF_TOPIC_REFUSAL[lang], stub: !env.openaiKey };
  const day = istDay();
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    update: {},
    create: { userId, day, count: 0 },
  });
  if (usage.count >= env.aiDailyLimit) throw httpError(429, "AI_LIMIT", "Daily match-buddy limit reached.");
  await prisma.aiUsage.update({ where: { id: usage.id }, data: { count: { increment: 1 } } });
  if (!env.openaiKey) return { text: stubAnswer(lang, message, match), stub: true };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.openaiModel,
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: `You are LiveLinePro's match buddy. Answer only about cricket and this match. Reply in ${lang === "hi" ? "Hindi" : "English"}. Never give betting tips, odds, session rates, or bookmaker talk. If asked, refuse politely. Keep it under 80 words.\nMatch: ${JSON.stringify(match.live || { result: match.result, name: match.name })}`,
          },
          { role: "user", content: message.slice(0, 500) },
        ],
      }),
    });
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    let text = json.choices?.[0]?.message?.content?.trim() || stubAnswer(lang, message, match);
    if (moderationDecision(text) === "betting") text = BETTING_REFUSAL[lang];
    return { text, stub: false };
  } catch {
    return { text: stubAnswer(lang, message, match), stub: true };
  }
}

function stubAnswer(lang: "en" | "hi", message: string, match: MatchView): string {
  const live = match.live;
  if (!live) {
    return lang === "hi"
      ? `${match.name} अभी लाइव नहीं है। ${match.result || match.toss}`
      : `${match.name} is not live right now. ${match.result || match.toss}`;
  }
  const bowler = live.bowler?.name || "the bowler";
  const striker = live.striker?.name || "the striker";
  if (lang === "hi") {
    return `${match.teams[live.batting].nameHi} ${live.runs}/${live.wickets} (${live.overs})। ${live.needHi || `रन रेट ${live.crr}`}. ${bowler} ${striker} को गेंद कर रहे हैं। मॉडल जीत संभावना ${match.teams.a.code} ${live.win.a}% · ${match.teams.b.code} ${live.win.b}%. यह स्कोर का सार है, सट्टे की सलाह नहीं।`;
  }
  return `${match.teams[live.batting].name} are ${live.runs}/${live.wickets} (${live.overs}). ${live.need || `Run rate ${live.crr}`}. ${bowler} is bowling to ${striker}. Model win probability: ${match.teams.a.code} ${live.win.a}% · ${match.teams.b.code} ${live.win.b}%. This is the match picture, not a betting tip. You asked: “${message.slice(0, 80)}”.`;
}
