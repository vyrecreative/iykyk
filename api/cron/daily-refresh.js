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
    mode: "daily-roster-source-check",
    checkedAt: payload.generatedAt,
    checkedAtEastern: payload.generatedAtEastern,
    refreshMode: payload.liveSource.refreshMode,
    officialMatchCount: payload.liveSource.officialMatchCount,
    activeWindows: payload.liveSource.activeWindows
  });
};
