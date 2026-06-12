# CupEdge Match Signals

CupEdge Match Signals is a standalone World Cup 2026 matchday probability site. It is analysis only and is not affiliated with FIFA, Vercel, GitHub, Google, Coinbase, or any sportsbook.

## Refresh Model

- `/api/matchday` fetches the official FIFA calendar API at request time and merges it with the source-backed model seed.
- `/api/cron/daily-refresh` is scheduled daily at `12:00 UTC`, which is `8:00 AM ET` during June daylight time. It checks official schedule and roster/source status.
- `/api/cron/match-window-refresh` is scheduled every 15 minutes. The endpoint identifies whether any match is within 90 minutes before kickoff through 150 minutes after kickoff and reports active windows.
- Vercel Cron Jobs run only in production deployments.
- The 15-minute cron requires a Vercel plan that allows sub-hourly cron frequency.

## Required Environment Variable

Set `CRON_SECRET` in Vercel before relying on the cron endpoints.

Vercel sends cron requests with `Authorization: Bearer $CRON_SECRET`. The endpoints reject cron calls when the secret is missing or incorrect.

## Local Check

Use Node to verify the serverless files:

```bash
node --check api/matchday.js
node --check api/cron/daily-refresh.js
node --check api/cron/match-window-refresh.js
node --check lib/matchday.js
```
