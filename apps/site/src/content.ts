/**
 * Editorial fixtures and previews (same facts as the @LiveLine_Pro launch posts). Times are IST.
 * Live feed matches are merged in automatically by team codes + date when Roanuz lists them.
 */
export interface CuratedTeam { code: string; name: string; color: string }
export interface Fixture { title: string; a: CuratedTeam; b: CuratedTeam; startIso: string; venue: string; note?: string; preview?: string }
export interface CuratedSeries { slug: string; name: string; short: string; blurb: string; fixtures: Fixture[]; feedSeriesHints: RegExp }
export interface Preview {
  slug: string; title: string; h1: string; a: CuratedTeam; b: CuratedTeam; startIso: string; when: string; venue: string;
  stage: string; summary: string; notes: string[]; series: string;
}

const T = (code: string, name: string, color: string): CuratedTeam => ({ code, name, color });
export const TEAMS = {
  IND: T("IND", "India", "#1f6feb"), WI: T("WI", "West Indies", "#7a1f3d"), BAN: T("BAN", "Bangladesh", "#0a8f4a"),
  SL: T("SL", "Sri Lanka", "#1d3a8a"), PAK: T("PAK", "Pakistan", "#0b6b33"),
};

export const SERIES: CuratedSeries[] = [
  {
    slug: "india-vs-west-indies-t20i-2026",
    name: "India vs West Indies T20I series 2026",
    short: "IND vs WI T20Is",
    blurb: "West Indies tour of India 2026 — five T20 Internationals, all at 7:00 PM IST (toss 6:30 PM). Shreyas Iyer leads India's T20I side.",
    feedSeriesHints: /west indies tour of india|india vs west indies|ind vs wi/i,
    fixtures: [
      { title: "1st T20I", a: TEAMS.IND, b: TEAMS.WI, startIso: "2026-10-06T19:00:00+05:30", venue: "Ekana Stadium, Lucknow" },
      { title: "2nd T20I", a: TEAMS.IND, b: TEAMS.WI, startIso: "2026-10-09T19:00:00+05:30", venue: "JSCA International Stadium, Ranchi" },
      { title: "3rd T20I", a: TEAMS.IND, b: TEAMS.WI, startIso: "2026-10-11T19:00:00+05:30", venue: "Holkar Stadium, Indore" },
      { title: "4th T20I", a: TEAMS.IND, b: TEAMS.WI, startIso: "2026-10-14T19:00:00+05:30", venue: "Rajiv Gandhi Intl. Stadium, Hyderabad" },
      { title: "5th T20I", a: TEAMS.IND, b: TEAMS.WI, startIso: "2026-10-17T19:00:00+05:30", venue: "M. Chinnaswamy Stadium, Bengaluru" },
    ],
  },
  {
    slug: "asian-games-2026-mens-cricket",
    name: "Asian Games 2026 — Men's T20 cricket",
    short: "Asian Games 2026",
    blurb: "Medal matches of the men's T20 cricket event at the 2026 Asian Games, played at Korogi Sports Park, Nisshin, Japan.",
    feedSeriesHints: /asian games/i,
    fixtures: [
      { title: "Bronze-medal match", a: TEAMS.BAN, b: TEAMS.SL, startIso: "2026-10-03T05:30:00+05:30", venue: "Korogi Sports Park, Nisshin, Japan", preview: "bangladesh-vs-sri-lanka-asian-games-bronze-preview" },
      { title: "Gold-medal match · Final", a: TEAMS.IND, b: TEAMS.PAK, startIso: "2026-10-03T10:00:00+05:30", venue: "Korogi Sports Park, Nisshin, Japan", preview: "india-vs-pakistan-asian-games-final-preview" },
    ],
  },
];

export const PREVIEWS: Preview[] = [
  {
    slug: "india-vs-pakistan-asian-games-final-preview",
    title: "India vs Pakistan, Asian Games 2026 final — preview, time & venue",
    h1: "India vs Pakistan — Asian Games 2026 final preview",
    a: TEAMS.IND, b: TEAMS.PAK, startIso: "2026-10-03T10:00:00+05:30",
    when: "Sat 3 Oct · 10:00 AM IST (1:30 PM local)", venue: "Korogi Sports Park, Nisshin, Japan",
    stage: "Gold-medal match", series: "asian-games-2026-mens-cricket",
    summary: "India (capt. Shreyas Iyer) are the defending champions after Hangzhou 2023 and reached the final with a 124-run win over Sri Lanka. Pakistan (capt. Sahibzada Farhan) beat Bangladesh by six wickets. If the final is washed out, a Super Over decides it.",
    notes: ["India: defending Asian Games champions (Hangzhou 2023)", "India beat Sri Lanka by 124 runs in the semi-final", "Pakistan beat Bangladesh by 6 wickets in their semi", "Washout? A Super Over decides the gold"],
  },
  {
    slug: "bangladesh-vs-sri-lanka-asian-games-bronze-preview",
    title: "Bangladesh vs Sri Lanka, Asian Games 2026 bronze-medal match — preview",
    h1: "Bangladesh vs Sri Lanka — Asian Games bronze-medal preview",
    a: TEAMS.BAN, b: TEAMS.SL, startIso: "2026-10-03T05:30:00+05:30",
    when: "Sat 3 Oct · 5:30 AM IST (9:00 AM local)", venue: "Korogi Sports Park, Nisshin, Japan",
    stage: "Bronze-medal match", series: "asian-games-2026-mens-cricket",
    summary: "Both sides lost their semi-finals and now play for a podium finish. Bangladesh call on most of their first-choice players; Sri Lanka field a younger squad. The Nisshin surface has helped spinners all week, and the forecast is sunny.",
    notes: ["Bangladesh field most of their first-choice XI", "Sri Lanka bring a younger, second-string squad", "Cracked, spin-friendly pitch · sunny forecast"],
  },
];
