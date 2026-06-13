"use strict";
/* Builds today's matchday payload from the REAL FIFA calendar feed + the CupEdge model.
   - status, score, live minute, formation come straight from FIFA.
   - group standings (for the motivation edge) are derived from finished matches in the feed.
   - starting XI is requested when FIFA exposes it; until then the lineup edge reads "pending". */

const model = require("./model");
const elo = require("../data/elo.json");
const squads = require("../data/squads.json").squads;

const FIFA_CALENDAR =
  "https://api.fifa.com/api/v3/calendar/matches?IdCompetition=17&IdSeason=285023&language=en&count=500";

const NAME_FIX = { "USA":"United States", "Korea Republic":"Korea Republic",
  "Bosnia and Herzegovina":"Bosnia and Herzegovina", "Turkiye":"Turkiye", "Türkiye":"Turkiye" };

function desc(v){ if (Array.isArray(v)) return v[0] && v[0].Description; return v; }
function fixName(n){ n = desc(n) || ""; return NAME_FIX[n] || n; }
function eloOf(n){ return elo.ratings[n] != null ? elo.ratings[n] : elo.defaultElo; }
function etDateKey(d){
  const p = new Intl.DateTimeFormat("en-CA",{ timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(d);
  const o = Object.fromEntries(p.map(x=>[x.type,x.value])); return `${o.year}-${o.month}-${o.day}`;
}
function etLabel(d){
  return new Intl.DateTimeFormat("en-US",{ timeZone:"America/New_York", hour:"numeric", minute:"2-digit" }).format(d) + " ET";
}
function minuteOf(matchTime){ if(!matchTime) return null; const m = String(matchTime).match(/(\d+)/); return m ? parseInt(m[1],10) : null; }

/* FIFA MatchStatus: 0 finished/in-play with score, 1 upcoming, 3 live (varies). We classify by score+time. */
function classify(match){
  const h = match.Home||{}, a = match.Away||{};
  const hasScore = h.Score!=null && a.Score!=null;
  const mt = minuteOf(match.MatchTime);
  if (match.MatchStatus === 1) return { state:"pre", minute:null };
  if (hasScore && (match.MatchStatus===0) && (mt===null || mt>=90)) return { state:"final", minute: mt };
  if (mt!=null) return { state:"live", minute: mt };
  return { state:"pre", minute:null };
}

function buildStandings(results){
  const tbl = {};
  for (const m of results){
    if (m.MatchStatus !== 0) continue;
    const h=m.Home||{}, a=m.Away||{};
    if (h.Score==null || a.Score==null) continue;
    const hn=fixName(h.TeamName), an=fixName(a.TeamName);
    for (const n of [hn,an]) tbl[n] = tbl[n] || { played:0, points:0, gf:0, ga:0 };
    tbl[hn].played++; tbl[an].played++;
    tbl[hn].gf+=h.Score; tbl[hn].ga+=a.Score; tbl[an].gf+=a.Score; tbl[an].ga+=h.Score;
    if (h.Score>a.Score){ tbl[hn].points+=3; } else if (h.Score<a.Score){ tbl[an].points+=3; } else { tbl[hn].points++; tbl[an].points++; }
  }
  return tbl;
}

/* Which day's fixtures to show. Default = today (ET). Once every match today is FINAL,
   roll forward to the next date that has fixtures, so after the last match of the day the
   board syncs to the next matchday automatically. */
function selectMatchday(results, now){
  const byDate = {};
  for (const m of results){
    if (!m.Date) continue;
    const k = etDateKey(new Date(m.Date));
    (byDate[k] = byDate[k] || []).push(m);
  }
  const today = etDateKey(now);
  const todays = byDate[today] || [];
  const allFinal = todays.length > 0 && todays.every(m => classify(m).state === "final");
  if (todays.length > 0 && !allFinal) return { dateKey: today, rolled: false, matches: todays };
  const future = Object.keys(byDate).filter(k => k > today).sort();
  if (future.length) return { dateKey: future[0], rolled: true, matches: byDate[future[0]] };
  if (todays.length) return { dateKey: today, rolled: false, matches: todays };
  const past = Object.keys(byDate).filter(k => k <= today).sort();
  if (past.length){ const k = past[past.length-1]; return { dateKey: k, rolled: false, matches: byDate[k] }; }
  return { dateKey: today, rolled: false, matches: [] };
}

async function buildPayload(opts){
  opts = opts || {};
  const now = opts.now || new Date();
  let results = opts.results;            // allow injecting feed for tests
  let sourceError = null;
  if (!results){
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);   // don't let a hung upstream hang the function
      const res = await fetch(FIFA_CALENDAR, { headers:{ accept:"application/json" }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("FIFA calendar HTTP "+res.status);
      const json = await res.json();
      results = Array.isArray(json.Results) ? json.Results : [];
    } catch(e){ sourceError = e.message; results = []; }
  }
  if (!Array.isArray(results)) results = [];   // defensive

  const standings = buildStandings(results);
  const picked = selectMatchday(results, now);   // today, rolling forward once today is done

  const matches = picked.matches.map(m => {
    const h=m.Home||{}, a=m.Away||{};
    const homeName=fixName(h.TeamName), awayName=fixName(a.TeamName);
    const cls = classify(m);
    const xiHome = (h.Players||[]).map(p=>desc(p.PlayerName||p.ShortName)).filter(Boolean);
    const xiAway = (a.Players||[]).map(p=>desc(p.PlayerName||p.ShortName)).filter(Boolean);

    const evalOut = model.evaluateMatch({
      homeName, awayName, homeElo: eloOf(homeName), awayElo: eloOf(awayName),
      homeAdv: elo.homeAdvElo, total: 2.55,
      live: cls.state==="live" ? { minute: cls.minute, hs: h.Score||0, as: a.Score||0 } : null,
      xiHome, xiAway, standings, squads
    });

    return {
      fifaId: String(m.IdMatch), matchNo: m.MatchNumber, group: desc(m.GroupName),
      kickoffUtc: m.Date, kickoffEt: etLabel(new Date(m.Date)),
      venue: desc((m.Stadium||{}).Name), city: desc((m.Stadium||{}).CityName),
      home: homeName, away: awayName, homeElo: eloOf(homeName), awayElo: eloOf(awayName),
      state: cls.state, minute: cls.minute, homeScore: h.Score, awayScore: a.Score,
      homeFormation: h.Tactics || null, awayFormation: a.Tactics || null,
      referees: (m.Officials||[]).filter(o=>o.OfficialType===1).map(o=>desc(o.NameShort)).filter(Boolean),
      lineupConfirmed: xiHome.length>0 && xiAway.length>0,
      model: evalOut
    };
  });

  const anyLive = matches.some(x=>x.state==="live");
  return {
    generatedAt: now.toISOString(),
    generatedAtEt: etLabel(now),
    matchdayDate: picked.dateKey,
    rolledForward: picked.rolled,
    refreshSeconds: anyLive ? 15 : 60,
    source: { fifa: FIFA_CALENDAR, eloSource: elo._source, sourceError, feedMatches: results.length },
    matches
  };
}

module.exports = { buildPayload, buildStandings, classify, selectMatchday };
