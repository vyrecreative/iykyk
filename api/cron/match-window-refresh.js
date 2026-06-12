const { buildMatchdayPayload, requireCronSecret } = require("../../lib/matchday");

module.exports = async function handler(request, response) {
  const cron = requireCronSecret(request);
  if (!cron.ok) {
    response.status(cron.status).json(cron);
    return;
  }

  const payload = await buildMatchdayPayload();
  response.status(200).json({
    ok: true,
    mode: "match-window-refresh",
    checkedAt: payload.generatedAt,
    checkedAtEastern: payload.generatedAtEastern,
    refreshMode: payload.liveSource.refreshMode,
    activeWindows: payload.liveSource.activeWindows,
    matches: payload.matches.map((match) => ({
      id: match.id,
      home: match.home,
      away: match.away,
      model: match.model,
      readiness: match.readiness,
      officialLineupStatus: match.official && match.official.officialLineupStatus,
      score:
        match.official && match.official.homeScore !== null
          ? `${match.official.homeScore}-${match.official.awayScore}`
          : null
    }))
  });
};
