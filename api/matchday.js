const { buildMatchdayPayload } = require("../lib/matchday");

module.exports = async function handler(request, response) {
  try {
    const payload = await buildMatchdayPayload();
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
};
