import { abs, appLink, channelLink, env } from "./env";
import { getPreview, listMatches, matchPath, slugify, type SiteMatch } from "./data";
import type { MatchPreview } from "@liveline/shared";
import { PREVIEWS, SERIES, type CuratedSeries, type Fixture } from "./content";
import { linoFacts, linoTake } from "./lino";
import { ball, empty, esc, flag, istDate, istDayKey, istTime, layout, matchCard, realToss, sectionHead, statusPill, tgCta, tgIcon, when } from "./html";

/* ---------------- helpers ---------------- */

export interface SeriesEntry { slug: string; name: string; short: string; blurb: string; matches: SiteMatch[]; fixtures: Fixture[]; curated: boolean }

function feedSeriesSlug(m: SiteMatch): string {
  const cur = SERIES.find((s) => s.feedSeriesHints.test(m.seriesName));
  return cur ? cur.slug : slugify(m.seriesName || m.seriesKey);
}

export async function allSeries(): Promise<SeriesEntry[]> {
  const matches = await listMatches();
  const map = new Map<string, SeriesEntry>();
  for (const c of SERIES) map.set(c.slug, { slug: c.slug, name: c.name, short: c.short, blurb: c.blurb, matches: [], fixtures: c.fixtures, curated: true });
  for (const m of matches) {
    const slug = feedSeriesSlug(m);
    if (!map.has(slug)) map.set(slug, { slug, name: m.seriesName, short: m.seriesName, blurb: `${m.seriesName} — live line, fixtures and results.`, matches: [], fixtures: [], curated: false });
    map.get(slug)!.matches.push(m);
  }
  return [...map.values()];
}

/** A feed match that corresponds to a curated fixture (same two team codes, same IST day). */
function feedFor(f: Fixture, matches: SiteMatch[]): SiteMatch | undefined {
  const day = istDayKey(Date.parse(f.startIso));
  const codes = [f.a.code, f.b.code].sort().join("-");
  return matches.find((m) => [m.teams.a.code, m.teams.b.code].sort().join("-") === codes && istDayKey(m.startAt) === day);
}

function fixtureRow(f: Fixture, matches: SiteMatch[]): string {
  const ms = Date.parse(f.startIso);
  const live = feedFor(f, matches);
  const href = live ? matchPath(live) : f.preview ? `/preview/${f.preview}` : "";
  const right = live ? statusPill(live) : ms < Date.now() - 5 * 3600_000 ? `<span class="pill done">Played</span>` : `<span class="pill soon">${esc(istTime(ms))} IST</span>`;
  const inner = `<div class="fx-date"><b>${esc(istDate(ms).split(" ")[1] || "")}</b><span>${esc(istDate(ms).split(" ")[2] || "")}</span></div>
    <div class="fx-main"><span class="fx-title">${esc(f.title)}</span><span class="fx-teams">${esc(f.a.name)} <em>vs</em> ${esc(f.b.name)}</span><span class="fx-venue">${esc(f.venue)}</span></div>
    <div class="fx-right">${right}</div>`;
  return href ? `<a class="fx card" href="${href}">${inner}</a>` : `<div class="fx card">${inner}</div>`;
}

function breadcrumbs(items: [string, string][]): unknown {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) })) };
}

function eventLd(name: string, startMs: number, venue: string, a: string, b: string, path: string, status: string): unknown {
  return {
    "@context": "https://schema.org", "@type": "SportsEvent", name, startDate: new Date(startMs).toISOString(), sport: "Cricket",
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: venue || "TBC" }, competitor: [{ "@type": "SportsTeam", name: a }, { "@type": "SportsTeam", name: b }], url: abs(path),
    description: status,
  };
}

/* ---------------- home ---------------- */

export async function homePage(): Promise<string> {
  const matches = await listMatches();
  const live = matches.filter((m) => m.status === "live");
  const upcoming = matches.filter((m) => m.status === "upcoming").slice(0, 6);
  const recent = matches.filter((m) => m.status === "completed").slice(0, 4);
  const series = await allSeries();
  const body = `
<section class="hero">
  <img class="hero-lino bob" src="/brand/mascot.svg" width="112" height="112" alt="Lino, the LiveLinePro mascot">
  <span class="kicker"><i class="ldot" aria-hidden="true"></i>${live.length ? `${live.length} live now` : "Ball-by-ball"} · Free</span>
  <h1>Cricket <span class="lime">live line</span>, faster than the TV.</h1>
  <p>Live scores, scorecards, wicket alerts and Lino AI insights for every big match.</p>
  <div class="hero-btns"><a class="tg-btn" href="${esc(appLink("home"))}" rel="noopener">${tgIcon()}Open in Telegram</a><a class="ghost-btn" href="/live">Live scores</a></div>
</section>
<div id="home-live" data-fragment="/fragment/home-live">${homeLive(live)}</div>
<!--ad:infeed-->
${sectionHead("Upcoming matches", "/schedule")}
<div class="list">${upcoming.length ? upcoming.map(matchCard).join("") : empty("No fixtures listed yet — check the schedule.")}</div>
${sectionHead("Series", "/schedule", "All series")}
<div class="chips">${series.map((s) => `<a class="chip" href="/series/${s.slug}">${esc(s.short)}</a>`).join("")}</div>
${sectionHead("Match previews")}
<div class="list">${PREVIEWS.map(previewCard).join("")}</div>
<a class="card lino-teaser" href="/lino"><img src="/brand/mascot.svg" width="56" height="56" alt=""><div><h3>Ask Lino — your AI cricket buddy</h3><p>Required rate, partnerships, player form and rules in plain words. English · हिंदी · Hinglish.</p></div><span class="arrow">→</span></a>
<!--ad:infeed-->
${recent.length ? `${sectionHead("Recent results", "/schedule#results")}<div class="list">${recent.map(matchCard).join("")}</div>` : ""}
${tgCta("Never miss a wicket", "Toss, wicket, fifty and result alerts straight to your Telegram — free.", "alerts")}
`;
  return layout({
    title: "LiveLinePro — Free Cricket Live Line, Live Score & Scorecard on Telegram",
    description: "Fast, free cricket live line: ball-by-ball live score, full scorecards, schedules, match previews and Lino AI insights. Get wicket alerts on Telegram. 18+, no betting.",
    path: "/", active: "home", refresh: "15000", tgParam: "home", adPage: "home",
  }, body);
}

export function homeLive(live: SiteMatch[]): string {
  return `${sectionHead("Live now", "/live", "Live centre", live.length > 0)}
<div class="list">${live.length ? live.map(matchCard).join("") : empty("No match is live right now. Upcoming fixtures are below — turn on alerts to get the toss in Telegram.")}</div>`;
}

function previewCard(p: (typeof PREVIEWS)[number]): string {
  return `<a class="card pv" href="/preview/${p.slug}"><div class="pv-teams">${flag(p.a, 34)}<b>vs</b>${flag(p.b, 34)}</div><div class="pv-txt"><span class="series">${esc(p.stage)}</span><h3>${esc(p.a.name)} vs ${esc(p.b.name)}</h3><p>${esc(p.when.replace(/\s*\([^)]*local\)/i, ""))}</p></div><span class="arrow" aria-hidden="true">→</span></a>`;
}

/* ---------------- live centre ---------------- */

export async function livePage(): Promise<string> {
  const matches = await listMatches();
  const live = matches.filter((m) => m.status === "live");
  const next = matches.filter((m) => m.status === "upcoming").slice(0, 4);
  const body = `<h1 class="ph">Live cricket scores</h1><p class="lede">Every match in play right now. Tap a match for the ball-by-ball live line and full scorecard.</p>
<div id="live-list" data-fragment="/fragment/live-list">${liveList(live)}</div>
${sectionHead("Starting soon", "/schedule")}<div class="list">${next.length ? next.map(matchCard).join("") : empty("Nothing scheduled in the next few days.")}</div>
${tgCta("Live line in Telegram", "Faster updates, alerts and Lino AI inside the free LiveLinePro app.", "live")}`;
  return layout({ title: "Live Cricket Score Today — Ball-by-Ball Live Line", description: "Live cricket score today with ball-by-ball live line, run rates and partnerships. Free, fast and ad-light. 18+, no betting.", path: "/live", active: "live", refresh: "8000", tgParam: "live" }, body);
}

export function liveList(live: SiteMatch[]): string {
  return `<div class="list">${live.length ? live.map(matchCard).join("") : empty("No match is live right now.")}</div>`;
}

/* ---------------- match ---------------- */

export async function matchPage(m: SiteMatch): Promise<string> {
  const path = matchPath(m);
  const A = m.teams.a.name, B = m.teams.b.name;
  const desc = m.status === "live"
    ? `${A} vs ${B} live score: ${m.scoreline.a} / ${m.scoreline.b}. Ball-by-ball live line, scorecard and Lino AI insights.`
    : m.status === "upcoming"
      ? `${A} vs ${B} — ${m.seriesName}, ${when(m.startAt)} at ${m.venue}. Preview, pitch report, head-to-head and live line.`
      : `${A} vs ${B} scorecard and result: ${m.result || ""}. Full batting and bowling figures.`;
  const titleWord = m.status === "live" ? "Live Score & Live Line" : m.status === "upcoming" ? "Preview, Time & Live Line" : "Scorecard & Result";
  const take = await linoTake(m);
  const body = `<nav class="crumbs"><a href="/">Home</a> › <a href="/series/${feedSeriesSlug(m)}">${esc(m.seriesName)}</a></nav>
<h1 class="ph sm">${esc(A)} vs ${esc(B)} <span>${esc(titleWord)}</span></h1>
<div id="match-live" data-fragment="/fragment/match/${encodeURIComponent(m.key)}">${matchLive(m, take)}</div>
${m.status === "upcoming" ? upcomingExtras(m, await getPreview(m.key)) : ""}
<!--ad:infeed-->
${tgCta(m.status === "completed" ? "Next match alerts" : `Get ${m.teams.a.code} vs ${m.teams.b.code} wicket alerts`, "Toss, every wicket, milestones and the result — straight to Telegram. Free.", `m_${m.key}`)}
`;
  return layout({
    title: `${A} vs ${B} ${titleWord} — ${m.seriesName}`,
    description: desc, path, ogImage: `/og/match/${encodeURIComponent(m.key)}.png`, active: "live",
    refresh: m.status === "live" ? "5000" : m.status === "upcoming" ? "60000" : "",
    tgParam: `m_${m.key}`, adPage: "match",
    jsonLd: [eventLd(`${A} vs ${B}, ${m.seriesName}`, m.startAt, m.venue, A, B, path, m.result || m.toss || m.status), breadcrumbs([["Home", "/"], [m.seriesName, `/series/${feedSeriesSlug(m)}`], [`${A} vs ${B}`, path]])],
  }, body);
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function cdCells(ms: number): string {
  const left = Math.max(0, ms - Date.now()), s = Math.floor(left / 1000);
  const parts: [string, number][] = [["Days", Math.floor(s / 86400)], ["Hrs", Math.floor(s / 3600) % 24], ["Min", Math.floor(s / 60) % 60], ["Sec", s % 60]];
  return parts.map(([l, v]) => `<span class="up-cd-c"><b>${pad2(v)}</b><small>${l}</small></span>`).join("");
}

/** Upcoming-match hero: badges, live countdown (site.js ticks [data-countdown]), IST + visitor-local time, venue, CTAs. */
function upcomingHero(m: SiteMatch): string {
  const side = (t: SiteMatch["teams"]["a"]) => `<div class="up-team">${flag(t, 58)}<b>${esc(t.name)}</b><span>${esc(t.code)}</span></div>`;
  const shareUrl = abs(matchPath(m));
  return `<section class="card sb upcoming up-hero">
  <div class="up-chips"><span class="up-chip">${esc(m.format)}</span><span class="up-chip ser">${esc(m.seriesName)}</span>${statusPill(m)}</div>
  <div class="up-vs">${side(m.teams.a)}<span class="up-vs-x">VS</span>${side(m.teams.b)}</div>
  <div class="up-cd" data-countdown="${m.startAt}" role="timer" aria-label="Time to start">${cdCells(m.startAt)}</div>
  <p class="up-when">🗓 ${esc(when(m.startAt))}<span class="up-local" data-local="${m.startAt}"></span></p>
  ${m.venue ? `<p class="up-when">📍 ${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</p>` : ""}
  ${realToss(m.toss) ? `<p class="toss">🪙 ${esc(m.toss)}</p>` : ""}
  <div class="up-btns"><a class="tg-btn" href="${esc(appLink(`m_${m.key}`))}" rel="noopener">${tgIcon()}Remind me</a><button type="button" class="ghost-btn" data-share="${esc(shareUrl)}" data-title="${esc(`${m.teams.a.name} vs ${m.teams.b.name} — live line on LiveLinePro`)}">↗ Share</button></div>
</section>`;
}

/** Static pre-match blocks (real data only; each block is hidden when there's nothing real to show). */
function upcomingExtras(m: SiteMatch, pv: MatchPreview | null): string {
  const A = m.teams.a, B = m.teams.b;
  const tossAt = istTime(m.startAt - 30 * 60_000);
  const toss = `<section class="card up-card"><h2 class="h2s">🪙 Toss</h2>${realToss(m.toss) ? `<p>${esc(m.toss)}</p>` : `<p class="muted">Toss around <b>${esc(tossAt)} IST</b> (usually 30 min before the start). We'll post it here and in Telegram.</p>`}</section>`;
  const predict = `<a class="card up-card up-predict" href="${esc(appLink(`pr_${m.key}`))}" rel="noopener"><span class="up-ic" aria-hidden="true">🎯</span><div><h2 class="h2s">Who wins?</h2><p class="muted">Call it before the toss in the Telegram app and earn XP on the fan leaderboard. Free — no money involved.</p></div><span class="arrow" aria-hidden="true">→</span></a>`;
  const dots = (f: MatchPreview["form"]["a"]) => f.map((x) => `<i class="fd ${x.r}" title="${esc(x.r)} vs ${esc(x.vs)}">${x.r}</i>`).join("");
  const form = pv && (pv.form.a.length || pv.form.b.length) ? `<section class="card up-card"><h2 class="h2s">Recent form</h2>
  <div class="up-form"><span>${flag(A, 26)} ${esc(A.code)}</span><span class="fds">${dots(pv.form.a) || '<em class="muted">No recent results</em>'}</span></div>
  <div class="up-form"><span>${flag(B, 26)} ${esc(B.code)}</span><span class="fds">${dots(pv.form.b) || '<em class="muted">No recent results</em>'}</span></div></section>` : "";
  const h = pv?.h2h;
  const h2h = h ? `<section class="card up-card"><h2 class="h2s">Head-to-head</h2>
  <div class="up-h2h"><b>${h.aWins}</b><span>${esc(A.code)}</span><div class="up-bar"><i style="width:${Math.round((h.aWins / Math.max(1, h.aWins + h.bWins)) * 100)}%"></i></div><span>${esc(B.code)}</span><b>${h.bWins}</b></div>
  <p class="muted">${h.played} recent meeting${h.played === 1 ? "" : "s"}${h.ties ? ` · ${h.ties} tied/no result` : ""}</p></section>` : "";
  const v = pv?.venue;
  const venue = v ? `<section class="card up-card"><h2 class="h2s">📍 At this venue</h2><div class="up-stats">
  <span><b>${v.avgFirst}</b><small>Avg 1st inns</small></span><span><b>${v.highestFirst}</b><small>Highest 1st</small></span><span><b>${v.defendsWon}</b><small>Won batting 1st</small></span><span><b>${v.chasesWon}</b><small>Won chasing</small></span></div>
  <p class="muted">From ${v.matches} recent completed matches here.</p></section>` : "";
  const st = pv?.standings || [];
  const standings = st.length ? `<section class="card up-card"><h2 class="h2s">Standings</h2><table class="tbl"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>NRR</th><th>Pts</th></tr></thead><tbody>
  ${st.map((r) => `<tr${r.side ? ' class="hl"' : ""}><td>${r.pos}</td><td>${esc(r.team)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${esc(r.nrr)}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table></section>` : "";
  const role = (r?: string) => r ? `<small>${esc(r)}</small>` : "";
  const squads = m.xi?.a?.length || m.xi?.b?.length ? `<details class="card up-card up-sq"><summary><h2 class="h2s">Squads</h2><span class="muted">${m.xi?.a?.length || 0} + ${m.xi?.b?.length || 0} players · tap to open</span></summary>
  <div class="xi"><div><h3>${esc(A.name)}</h3><ul>${(m.xi?.a || []).map((p: any) => `<li>${esc(p.name)}${role(p.role)}</li>`).join("")}</ul></div><div><h3>${esc(B.name)}</h3><ul>${(m.xi?.b || []).map((p: any) => `<li>${esc(p.name)}${role(p.role)}</li>`).join("")}</ul></div></div></details>` : "";
  return `<div class="up-grid">${predict}${toss}${form}${h2h}${venue}${standings}${squads}</div>`;
}

/** The auto-refreshing part of the match page (also served alone as a fragment). */
export function matchLive(m: SiteMatch, take: string | null): string {
  const live = m.live;
  const score = (side: "a" | "b") => {
    const t = m.teams[side];
    const sc = m.scoreline[side] && m.scoreline[side] !== "—" ? m.scoreline[side] : m.status === "upcoming" ? "" : "Yet to bat";
    return `<div class="sb-team${live?.batting === side ? " bat" : ""}">${flag(t, 40)}<b class="sb-name">${esc(t.name)}</b>${sc ? `<span class="sb-sc${sc === "Yet to bat" ? " ytb" : ""}">${esc(sc)}</span>` : ""}</div>`;
  };
  const scoreboard = m.status === "upcoming" ? upcomingHero(m) : `<section class="card sb ${m.status}">
  <div class="mc-head"><span class="series">${esc(m.format)} · ${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</span>${statusPill(m)}</div>
  ${score("a")}${score("b")}
  ${live ? `<div class="sb-big"><span class="r">${live.runs}/${live.wickets}</span><span class="o">${esc(live.overs)} ov</span></div>
  <div class="sb-rates"><span>CRR <b>${live.crr.toFixed(2)}</b></span>${live.rrr != null ? `<span>RRR <b>${live.rrr.toFixed(2)}</b></span>` : ""}${live.target ? `<span>Target <b>${live.target}</b></span>` : live.projected ? `<span>Projected <b>${live.projected}</b></span>` : ""}<span>P'ship <b>${live.partnership.runs}(${live.partnership.balls})</b></span></div>
  ${live.need ? `<p class="need">${esc(live.need)}</p>` : ""}` : ""}
  ${m.status === "completed" ? `<p class="need done">${esc(m.result || "Match complete")}</p>` : ""}
  ${realToss(m.toss) ? `<p class="toss">🪙 ${esc(m.toss)}</p>` : ""}
</section>`;

  const crease = live ? `<section class="card crease">
  <h2 class="h2s">At the crease</h2>
  <table class="tbl"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>
  ${[live.striker, live.nonStriker].filter(Boolean).map((b) => `<tr><td>${esc(b!.name)}${b!.strike ? " <i class=\"strike\">*</i>" : ""}</td><td><b>${b!.runs}</b></td><td>${b!.balls}</td><td>${b!.fours}</td><td>${b!.sixes}</td><td>${b!.balls ? ((b!.runs * 100) / b!.balls).toFixed(1) : "0.0"}</td></tr>`).join("")}
  </tbody></table>
  ${live.bowler ? `<table class="tbl"><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody><tr><td>${esc(live.bowler.name)}</td><td>${esc(live.bowler.overs)}</td><td>${live.bowler.runs}</td><td><b>${live.bowler.wickets}</b></td><td>${live.bowler.economy.toFixed(2)}</td></tr></tbody></table>` : ""}
  <div class="over"><span>This over</span><div class="balls">${live.thisOver.map(ball).join("") || "<em>New over</em>"}</div></div>
  <div class="over"><span>Last 12</span><div class="balls">${live.recent.map(ball).join("")}</div></div>
</section>` : "";

  const facts = linoFacts(m);
  const lino = `<section class="card lino" id="lino">
  <div class="lino-h"><img src="/brand/mascot.svg" width="44" height="44" alt=""><div><h2 class="h2s">Lino's insights</h2><span class="muted">${m.status === "live" ? "Updates every ball" : m.status === "upcoming" ? "Pre-match" : "Post-match"}</span></div></div>
  ${take ? `<p class="take">“${esc(take)}”</p>` : ""}
  <ul class="facts">${facts.map((f) => `<li><span>${f.icon}</span>${esc(f.text)}</li>`).join("") || "<li>Lino is waiting for the first ball.</li>"}</ul>
  <a class="tg-btn sm wide" href="${esc(appLink(`l_${m.key}`))}" rel="noopener">${tgIcon()}Ask Lino about this match</a>
</section>`;

  const comm = m.commentary?.length ? `<section class="card comm" id="commentary"><h2 class="h2s">Ball-by-ball commentary</h2>
  <ol class="cm">${m.commentary.map((c) => `<li class="k-${esc(c.kind.toLowerCase())}"><span class="ov">${esc(c.over)}</span><p>${esc(c.text)}</p></li>`).join("")}</ol></section>` : "";

  const cards = (m.innings || []).filter((i) => i.batters.length || i.bowlers.length).map((inn, idx) => `<details class="card inn"${idx === (m.innings!.length - 1) ? " open" : ""}>
  <summary><b>${esc(inn.title)}</b><span>${inn.runs}/${inn.wickets} (${esc(inn.overs)})</span></summary>
  <table class="tbl"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>
  ${inn.batters.map((b) => `<tr><td>${esc(b.name)}<small>${esc(b.out ? b.dismissal || "out" : "not out")}</small></td><td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${b.balls ? ((b.runs * 100) / b.balls).toFixed(1) : "-"}</td></tr>`).join("")}
  <tr class="ex"><td>Extras</td><td colspan="5">${inn.extras}</td></tr></tbody></table>
  <table class="tbl"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>
  ${inn.bowlers.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.overs)}</td><td>${b.maidens}</td><td>${b.runs}</td><td><b>${b.wickets}</b></td><td>${b.economy.toFixed(2)}</td></tr>`).join("")}
  </tbody></table></details>`).join("");

  const preview = ""; // upcoming matches: see upcomingHero + upcomingExtras

  const points = m.points?.length && m.status !== "upcoming" ? `<section class="card"><h2 class="h2s">Points table</h2><table class="tbl"><thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>NRR</th><th>Pts</th></tr></thead><tbody>
  ${m.points.map((r) => `<tr><td>${esc(r.team)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${esc(r.nrr)}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table></section>` : "";

  const tabs = `<nav class="seg"><a href="#lino">Lino</a>${m.commentary?.length ? `<a href="#commentary">Commentary</a>` : ""}${cards ? `<a href="#scorecard">Scorecard</a>` : ""}</nav>`;
  // Mobile: one column in reading order (flex + order). Desktop: scoreboard/crease/scorecard left, Lino + commentary right.
  return `<div class="ml"><div class="ml-a">${scoreboard}${m.status !== "upcoming" ? tabs : ""}${crease}${cards ? `<div id="scorecard" class="o6">${sectionHead("Scorecard")}${cards}</div>` : ""}${preview}${points}</div><div class="ml-b">${lino}${comm}</div></div><p class="updated">Updated ${esc(istTime(Date.now()))} IST${m.status === "live" ? " · auto-refreshing" : ""}</p>`;
}

/* ---------------- schedule / series ---------------- */

export async function schedulePage(): Promise<string> {
  const matches = await listMatches();
  const series = await allSeries();
  const feedUp = matches.filter((m) => m.status !== "completed");
  const byDay = new Map<string, SiteMatch[]>();
  for (const m of feedUp) {
    const d = istDayKey(m.startAt);
    byDay.set(d, [...(byDay.get(d) || []), m]);
  }
  const results = matches.filter((m) => m.status === "completed");
  const body = `<h1 class="ph">Cricket schedule</h1><p class="lede">Upcoming fixtures, series and results. All times in IST.</p>
<div class="chips">${series.map((s) => `<a class="chip" href="/series/${s.slug}">${esc(s.short)}</a>`).join("")}</div>
<!--ad:infeed-->
${[...byDay.entries()].map(([d, ms]) => `${sectionHead(istDate(ms[0].startAt) + (d === istDayKey(Date.now()) ? " · Today" : ""))}<div class="list">${ms.map(matchCard).join("")}</div>`).join("")}
${series.filter((s) => s.curated).map((s) => `${sectionHead(s.name, `/series/${s.slug}`, "Series")}<div class="list">${s.fixtures.map((f) => fixtureRow(f, matches)).join("")}</div>`).join("")}
<!--ad:infeed-->
<div id="results">${results.length ? `${sectionHead("Recent results")}<div class="list">${results.map(matchCard).join("")}</div>` : ""}</div>
${tgCta("Get the toss in Telegram", "Pick your teams once — LiveLinePro pings you before every match.", "schedule")}`;
  return layout({ title: "Cricket Schedule & Fixtures 2026 — IND vs WI T20Is, Asian Games", description: "Upcoming cricket schedule with match times in IST: India vs West Indies T20I series, Asian Games 2026 cricket, live and recent results.", path: "/schedule", active: "schedule", tgParam: "schedule", adPage: "schedule" }, body);
}

export async function seriesPage(s: SeriesEntry): Promise<string> {
  const matches = await listMatches();
  const path = `/series/${s.slug}`;
  const feedOnly = s.matches.filter((m) => !s.fixtures.some((f) => feedFor(f, [m])));
  const pts = s.matches.find((m) => m.points?.length);
  const body = `<nav class="crumbs"><a href="/">Home</a> › <a href="/schedule">Schedule</a></nav>
<h1 class="ph sm">${esc(s.name)}</h1><p class="lede">${esc(s.blurb)}</p>
${s.fixtures.length ? `${sectionHead("Fixtures")}<div class="list">${s.fixtures.map((f) => fixtureRow(f, matches)).join("")}</div>` : ""}
${feedOnly.length ? `${sectionHead(s.fixtures.length ? "More matches" : "Matches")}<div class="list">${feedOnly.map(matchCard).join("")}</div>` : ""}
${PREVIEWS.filter((p) => p.series === s.slug).length ? `${sectionHead("Previews")}<div class="list">${PREVIEWS.filter((p) => p.series === s.slug).map(previewCard).join("")}</div>` : ""}
${pts?.points?.length ? `<section class="card"><h2 class="h2s">Points table</h2><table class="tbl"><thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>NRR</th><th>Pts</th></tr></thead><tbody>${pts.points.map((r) => `<tr><td>${esc(r.team)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${esc(r.nrr)}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table></section>` : ""}
${tgCta(`Follow ${s.short} on Telegram`, "Toss, wicket and result alerts for every match of the series.", `s_${s.slug.slice(0, 40)}`)}`;
  return layout({
    title: `${s.name} — Schedule, Live Score & Results`, description: `${s.blurb} Live line, scorecards and alerts on LiveLinePro.`.slice(0, 300), path, active: "schedule",
    tgParam: "schedule", jsonLd: [breadcrumbs([["Home", "/"], ["Schedule", "/schedule"], [s.name, path]]),
      ...s.fixtures.map((f) => eventLd(`${f.a.name} vs ${f.b.name}, ${f.title}`, Date.parse(f.startIso), f.venue, f.a.name, f.b.name, path, f.title))],
  }, body);
}

/* ---------------- previews ---------------- */

export async function previewPage(p: (typeof PREVIEWS)[number]): Promise<string> {
  const matches = await listMatches();
  const path = `/preview/${p.slug}`;
  const feed = feedFor({ title: p.stage, a: p.a, b: p.b, startIso: p.startIso, venue: p.venue }, matches);
  const body = `<nav class="crumbs"><a href="/">Home</a> › <a href="/series/${p.series}">Series</a></nav>
<article class="card art">
  <div class="pv-hero">${flag(p.a, 56)}<span class="vs">VS</span>${flag(p.b, 56)}</div>
  <span class="series">${esc(p.stage)}</span>
  <h1 class="ph sm">${esc(p.h1)}</h1>
  <p class="meta">📅 ${esc(p.when)}<br>📍 ${esc(p.venue)}</p>
  <p>${esc(p.summary)}</p>
  <h2 class="h2s">Key talking points</h2>
  <ul class="facts">${p.notes.map((n) => `<li><span>•</span>${esc(n)}</li>`).join("")}</ul>
  ${feed ? `<a class="tg-btn wide" href="${matchPath(feed)}">${feed.status === "live" ? "● Follow the live line" : "Open match centre"}</a>` : ""}
</article>
${tgCta("Live line + alerts for this match", "Ball-by-ball updates, wicket alerts and Lino's take — free on Telegram.", `p_${p.slug.slice(0, 40)}`)}`;
  return layout({
    title: p.title, description: `${p.summary}`.slice(0, 280), path, ogImage: `/og/preview/${p.slug}.png`, active: "schedule", tgParam: "preview",
    jsonLd: [{ "@context": "https://schema.org", "@type": "Article", headline: p.h1, datePublished: "2026-10-02", author: { "@type": "Organization", name: "LiveLinePro" }, image: abs(`/og/preview/${p.slug}.png`) },
      eventLd(`${p.a.name} vs ${p.b.name}, ${p.stage}`, Date.parse(p.startIso), p.venue, p.a.name, p.b.name, path, p.stage)],
  }, body);
}

/* ---------------- Lino ---------------- */

export async function linoBlocks(): Promise<string> {
  const matches = await listMatches();
  const featured = matches.filter((m) => m.status !== "completed").slice(0, 3);
  const blocks = await Promise.all(featured.map(async (m) => {
    const take = await linoTake(m);
    const facts = linoFacts(m).slice(0, 4);
    return `<a class="card li" href="${matchPath(m)}#lino"><div class="mc-head"><span class="series">${esc(m.teams.a.code)} vs ${esc(m.teams.b.code)} · ${esc(m.seriesName)}</span>${statusPill(m)}</div>
    ${take ? `<p class="take">“${esc(take)}”</p>` : ""}<ul class="facts">${facts.map((f) => `<li><span>${f.icon}</span>${esc(f.text)}</li>`).join("")}</ul></a>`;
  }));
  return blocks.join("") || empty("No live or upcoming match right now — Lino will be back at the toss.");
}

export async function linoPage(): Promise<string> {
  const blocks = await linoBlocks();
  const body = `<section class="lino-hero">
  <img src="/brand/mascot.svg" width="132" height="132" alt="Lino" class="bob">
  <h1>Meet <span class="orange">Lino</span></h1>
  <p>Your AI cricket buddy. Ask about the chase, a player's form or a rule — in English, हिंदी or Hinglish. Free inside LiveLinePro.</p>
  <a class="tg-btn" href="${esc(appLink("lino"))}" rel="noopener">${tgIcon()}Ask Lino on Telegram</a>
</section>
${sectionHead("Lino's take on today's matches")}
<div class="list" id="lino-list" data-fragment="/fragment/lino">${blocks}</div>
<!--ad:infeed-->
${sectionHead("Try asking")}
<div class="asks">${["What does India need off the last 5 overs?", "Who has the best economy in this match?", "Explain the Super Over rule in 2 lines.", "Kal ka match kitne baje hai?"].map((q) => `<a class="ask" href="${esc(appLink("lino"))}" rel="noopener">“${esc(q)}”</a>`).join("")}</div>
<section class="card note"><h2 class="h2s">What Lino won't do</h2><p>Lino talks cricket only. No betting tips, odds, session rates or win percentages — ever. Lino's insights are based on the live scorecard and can be wrong; always enjoy responsibly.</p></section>`;
  return layout({ title: "Lino AI — Cricket Match Insights & Live Analysis", description: "Lino is LiveLinePro's free AI cricket buddy: live match insights, required run rate, partnerships and player form in plain English or Hindi. No betting, ever.", path: "/lino", active: "lino", tgParam: "lino", refresh: "30000", adPage: "lino" }, body);
}

/* ---------------- alerts / about ---------------- */

export function alertsPage(): string {
  const items = [["🪙", "Toss & playing XI", "Know who's batting first before the first ball."], ["☝️", "Every wicket", "Instant ping with the batter, bowler and score."], ["💯", "Fifties & hundreds", "Milestones the moment they happen."], ["🏁", "Results", "Final scores and the player of the match."]];
  const body = `<h1 class="ph">Wicket & match alerts</h1><p class="lede">Free alerts in Telegram for the teams and series you follow. No app install, no spam — mute any time.</p>
<div class="list">${items.map(([i, t, d]) => `<div class="card al"><span class="al-i">${i}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join("")}</div>
<section class="card steps"><h2 class="h2s">How to turn them on</h2><ol><li>Tap <b>Open in Telegram</b> below.</li><li>Start <b>@${esc(env.botUsername)}</b> and open the Alerts tab.</li><li>Pick your teams — done.</li></ol>
<a class="tg-btn wide" href="${esc(appLink("alerts"))}" rel="noopener">${tgIcon()}Open in Telegram</a>
<a class="ghost-btn wide" href="${esc(channelLink())}" rel="noopener">Join the @${esc(env.channelUsername)} channel</a></section>`;
  return layout({ title: "Free Cricket Wicket Alerts on Telegram", description: "Get free cricket alerts on Telegram: toss, every wicket, fifties, hundreds and results for your teams. 18+, no betting.", path: "/alerts", active: "alerts", tgParam: "alerts" }, body);
}

export function aboutPage(): string {
  const body = `<h1 class="ph">About LiveLinePro</h1>
<section class="card art"><p>LiveLinePro is a free cricket companion on Telegram: a fast ball-by-ball live line, full scorecards, match alerts and Lino, an AI buddy that explains the game.</p>
<h2 class="h2s">Our rules</h2><ul class="facts"><li><span>🔞</span>For fans aged 18+.</li><li><span>🚫</span>No betting, odds, wagering or real-money games — anywhere in the product.</li><li><span>🏅</span>Fan points and badges are just for fun and have no money value.</li><li><span>📡</span>Scores come from a licensed data feed and can be delayed by a few seconds.</li></ul>
<h2 class="h2s">Find us</h2><p>Bot: <a href="${esc(appLink("about"))}">@${esc(env.botUsername)}</a> · Channel: <a href="${esc(channelLink())}">@${esc(env.channelUsername)}</a></p></section>`;
  return layout({ title: "About LiveLinePro", description: "LiveLinePro is a free Telegram cricket live line with scorecards, alerts and Lino AI. 18+, no betting, points have no money value.", path: "/about", tgParam: "about" }, body);
}

export function notFoundPage(): string {
  return layout({ title: "Page not found", description: "This page does not exist.", path: "/404", noindex: true }, `<section class="nf"><img src="/brand/mascot.svg" width="120" height="120" alt="" class="bob"><b class="nf-code">404</b><h1>That page is out</h1><p>Caught at long-on. Try the live centre or the schedule.</p><div class="hero-btns center"><a class="tg-btn" href="/live">Live scores</a><a class="ghost-btn" href="/schedule">Schedule</a></div></section>`);
}
