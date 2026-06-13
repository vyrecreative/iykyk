"use strict";
const { buildPayload } = require("../lib/matchday");

module.exports = async function handler(req, res) {
  try {
    const payload = await buildPayload();
    // cache 15s at the edge, serve stale up to 60s while revalidating
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
