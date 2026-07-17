# Yearworm API (daily leaderboard)

Cloudflare Worker + D1. No accounts, no personal data — a random device
token, a nickname, a score. One submission per device per daily (the first
stands; resubmits may only refresh the nickname).

## Endpoints
- `GET /health` → `{ ok, day }`
- `GET /daily?day=N&device=<token>` → `{ day, total, top[25], me:{rank,score,timeMs}|null }`
- `POST /daily` `{day, device, nick, score, timeMs}` → same shape as GET (incl. your rank)

Validation: day within ±1 of the server's daily number (UTC epoch 2026-07-01,
mirrors index.html), score 0..5, timeMs 500..350000, device `[a-f0-9]{16,64}`,
nick sanitized to 16 chars. Burst limit ~30 req/min/IP (best effort).

## Owner setup (one-time, ~5 min)
1. Free account on https://dash.cloudflare.com (no domain needed).
2. `npm i -g wrangler && wrangler login` (or set `CLOUDFLARE_API_TOKEN` with
   Workers + D1 edit permissions for headless use).
3. In this directory:
   - `wrangler d1 create yearworm` → paste the printed `database_id` into `wrangler.toml`
   - `wrangler d1 execute yearworm --remote --file=schema.sql`
   - `wrangler deploy` → prints `https://yearworm-api.<account>.workers.dev`
4. Put that URL in `LB.url` in index.html (top of the script, next to REPORT)
   and bump the build — the leaderboard UI turns on. Also update privacy.html
   (nickname + score leave the device when submitting a daily).

## Costs
Free tier: 100k requests/day, 5M D1 reads/day — orders of magnitude above a
small launch. No credit card required.
