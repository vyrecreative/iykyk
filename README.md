# CupEdge Match Signals

World Cup 2026 match-edge model. Analysis only, not affiliated with FIFA, Robinhood, Kalshi, or any sportsbook.

It prices each match from real data, compares the model to the contract price you see, and shows the edge. Money and sizing are entirely the user's call (no bankroll or staking logic in the app).

## Data sources (real, not placeholder)

- **Ratings:** real national-team Elo from eloratings.net (`data/elo.json`, refresh by re-pulling `World.tsv`).
- **Live match state:** the official FIFA calendar API (status, score, live minute, formation, referees) at request time.
- **Model:** Elo to expected goals, then a Dixon-Coles bivariate-Poisson scoreline grid for calibrated 1X2, over/under, and BTTS.
- **Player shot maps (the field):** real recorded shots from **StatsBomb Open Data** (World Cup 2022 + Euro 2024), aggregated per player into average location, xG/shot, and shots per match (`tools/build_squads_statsbomb.py` -> `data/squads.json`). Teams not in the open dataset (e.g. Haiti) are omitted and the field renders an honest "no data" state. The left/right shift with the live score is model logic on the real clock, labeled as such; true in-match shot updates would need a paid feed.
- **Edge inputs the market often misprices:**
  - **Lineup availability** (`lib/model.js` -> `lineupAdjust`): when FIFA publishes the starting XI, every key player missing subtracts their `eloImpact` (`data/squads.json`) from that side, shifting the model. Until the XI publishes it reads "XI pending."
  - **Motivation / dead rubber** (`motivationAdjust`): group standings are derived from finished matches in the feed; a side that has clinched or been eliminated before its final group game gets a rotation-risk downgrade and a wider draw.
- **Market price:** you enter the price you see on Robinhood / Kalshi (in cents). Prefilled with the model fair value so edge starts at 0. Kalshi per-match markets are `KXWCGAME-<date><HOMEAWAY>` once they have liquidity.

## Security & date handling

- **Security headers** (`vercel.json`): Content-Security-Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS, Permissions-Policy.
- **XSS:** every string from the FIFA feed (team, group, venue, formation, status) is HTML-escaped before it touches the DOM.
- **Resilience:** the FIFA fetch has an 8s abort timeout and validates the response; on any failure the API returns a clean payload with `sourceError` and the page keeps its last good render.
- **Date auto-roll:** the server shows today's ET fixtures and, once every match today is final, rolls forward to the next date with fixtures (`matchdayDate` / `rolledForward` in the payload). The board stays synced to the live matchday with no manual change.

## How it refreshes

- `GET /api/matchday` fetches the FIFA calendar, filters today's matches in Eastern time, computes the model + edges, and returns JSON. Edge-cached 15s.
- The page polls `/api/matchday` on the cadence the API returns (`refreshSeconds`): 15s when any match is live, 60s otherwise. When a match kicks off, status/minute/score come straight from FIFA and the in-play model re-prices each poll.
- A daily Vercel cron (`vercel.json`) keeps the function warm.
- Opened as a local file (no API), the page falls back to embedded fixtures so it still renders.

## Structure

```
api/matchday.js      serverless handler -> JSON payload
lib/matchday.js      FIFA fetch + today filter + standings + payload
lib/model.js         Elo -> Dixon-Coles + lineup + motivation edges
data/elo.json        real national-team Elo
data/squads.json     player threat + key-player Elo impact
public/index.html    trading-terminal front-end (polls /api/matchday)
vercel.json          routing + daily cron
```

## Local check

```
npm run check        # node --check on the serverless files
node -e "require('./lib/matchday').buildPayload().then(p=>console.log(p.matches.map(m=>m.home+' '+Math.round(m.model.home*100)+'%')))"
```

## Deploy

1. Push this folder to the `vyrecreative/iykyk` repo (replacing the old files).
2. Vercel auto-deploys from the repo. No environment variables are required for the public model; set `CRON_SECRET` only if you re-enable protected cron endpoints.
3. The live site is served from `public/index.html` and pulls real data via `/api/matchday`.
