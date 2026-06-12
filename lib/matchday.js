const seed = require("../data/seed.json");

const FIFA_CALENDAR_URL =
  "https://api.fifa.com/api/v3/calendar/matches?IdCompetition=17&IdSeason=285023&language=en&count=500";

function description(value) {
  if (Array.isArray(value)) {
    return value[0] && value[0].Description ? value[0].Description : null;
  }
  return value || null;
}

function easternDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const out = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${out.year}-${out.month}-${out.day}`;
}

function easternTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function normalizeTeamName(name) {
  if (name === "USA") return "United States";
  if (name === "Korea Republic") return "South Korea";
  return name;
}

function extractReferees(match) {
  return (match.Officials || [])
    .filter((official) => {
      const type = description(official.TypeLocalized);
      return type === "Referee" || official.OfficialType === 1;
    })
    .map((official) => description(official.NameShort) || description(official.Name))
    .filter(Boolean);
}

function officialMatchSnapshot(match) {
  const home = match.Home || {};
  const away = match.Away || {};
  const stadium = match.Stadium || {};
  return {
    fifaMatchId: String(match.IdMatch),
    matchNo: match.MatchNumber,
    group: description(match.GroupName),
    kickoffUtc: match.Date,
    kickoffEastern: easternTimeLabel(new Date(match.Date)),
    home: normalizeTeamName(description(home.TeamName)),
    away: normalizeTeamName(description(away.TeamName)),
    homeScore: home.Score ?? null,
    awayScore: away.Score ?? null,
    homeTactics: home.Tactics || null,
    awayTactics: away.Tactics || null,
    matchStatus: match.MatchStatus,
    officialityStatus: match.OfficialityStatus,
    matchTime: match.MatchTime || null,
    venue: description(stadium.Name),
    city: description(stadium.CityName),
    referees: extractReferees(match),
    officialLineupStatus:
      home.Tactics || away.Tactics
        ? "FIFA tactics visible. Starter-name fields still require official/team confirmation."
        : "Official starting XI and tactics pending in accessible FIFA calendar fields."
  };
}

async function fetchOfficialMatches(targetDate = new Date()) {
  const response = await fetch(FIFA_CALENDAR_URL, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`FIFA calendar returned ${response.status}`);
  }
  const json = await response.json();
  const results = Array.isArray(json.Results) ? json.Results : [];
  const today = easternDateKey(targetDate);
  return results
    .filter((match) => match.Date && easternDateKey(new Date(match.Date)) === today)
    .map(officialMatchSnapshot);
}

function isInsideMatchWindow(match, now = new Date()) {
  const kickoff = new Date(match.kickoffEt);
  const start = kickoff.getTime() - 90 * 60 * 1000;
  const end = kickoff.getTime() + 150 * 60 * 1000;
  return now.getTime() >= start && now.getTime() <= end;
}

function mergeOfficial(seedMatch, official) {
  return {
    ...seedMatch,
    official: official || {
      fifaMatchId: seedMatch.fifaMatchId,
      officialLineupStatus: "Official source unavailable for this refresh.",
      sourceError: true
    },
    readiness:
      official && (official.homeTactics || official.awayTactics)
        ? "FIFA tactics visible. Verify starter names before calling the lineup official."
        : seedMatch.readiness
  };
}

async function buildMatchdayPayload(options = {}) {
  const now = options.now || new Date();
  let officialMatches = [];
  let sourceError = null;
  try {
    officialMatches = await fetchOfficialMatches(now);
  } catch (error) {
    sourceError = error.message;
  }

  const officialById = new Map(
    officialMatches.map((match) => [String(match.fifaMatchId), match])
  );
  const matches = seed.matches.map((match) =>
    mergeOfficial(match, officialById.get(String(match.fifaMatchId)))
  );
  const activeWindows = matches
    .filter((match) => isInsideMatchWindow(match, now))
    .map((match) => match.id);

  return {
    ...seed,
    generatedAt: now.toISOString(),
    generatedAtEastern: easternTimeLabel(now),
    liveSource: {
      label: "FIFA calendar API",
      url: FIFA_CALENDAR_URL,
      checkedAt: now.toISOString(),
      checkedAtEastern: easternTimeLabel(now),
      sourceError,
      officialMatchCount: officialMatches.length,
      activeWindows,
      refreshMode:
        activeWindows.length > 0
          ? "Match-window refresh. Recheck every 15 minutes."
          : "Daily roster/source watch. Recheck more aggressively inside match windows."
    },
    matches
  };
}

function requireCronSecret(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: "CRON_SECRET is not configured. Add it in Vercel project environment variables to activate cron endpoints."
    };
  }
  const auth = request.headers.authorization || request.headers.Authorization;
  if (auth !== `Bearer ${secret}`) {
    return {
      ok: false,
      status: 401,
      message: "Unauthorized cron request."
    };
  }
  return { ok: true };
}

module.exports = {
  buildMatchdayPayload,
  requireCronSecret
};
