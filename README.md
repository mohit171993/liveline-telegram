# LiveLine Pro

A Telegram Mini App for the live cricket line, built for India. It ships with the bot `@LiveLineProBot`, a sponsor manager that opens inside Telegram, and a free rewards zone. There are no betting odds, session rates, bookmaker prices, cash prizes, or withdrawals.

The cricket feed sits behind a provider interface. With `USE_MOCK_PROVIDER=true` a simulator plays a live match, settles predictions, and updates the board without Roanuz keys. Football and kabaddi have reserved slots in the same registry.

The mark is a cricket ball cut by a neon pulse. Lino is the mascot. Dark is navy with lime, cyan, and orange. Light uses the same accents on a pale field. Tokens live in `apps/web/src/styles.css`. Profile pictures for the bot and the channel are in `apps/web/public/brand/` at 512 and 640.

## What you get

- Mini app: live, upcoming, and recent matches, favourite teams, series filter, ball-by-ball line, FOUR / SIX / WICKET moments, CRR, RRR, projected score, a model win probability (not a price), scorecard, commentary, wagon, Manhattan and worm charts, XI, venue, head-to-head, points, Hindi and English, Telegram theme, haptics, BackButton and MainButton.
- Verification: every API, WebSocket, and SSE call checks Telegram `initData` (HMAC + `auth_date`). Outside Telegram the app shows Open in Telegram and no scores. First launch asks for a phone via Telegram's contact request (the contact must belong to the same user) and acceptance of the terms. Admins can block and unblock.
- Predictions: next ball, over, and match result for points. The server locks the window before the ball and settles from the feed.
- Watch party chat, reactions, polls, Hindi and English profanity filter, admin mute and ban.
- AI match buddy. With no `OPENAI_API_KEY` it answers from the live match and still refuses betting and off-topic questions. Daily cap included.
- Reminders: 15 / 30 / 60 minutes before a match, follow teams and series, alert types, history. BullMQ on Redis delivers them and dedupes across restarts.
- Referrals via `ref_<telegramId>`, shareable score cards, group boards via `grp_<chatId>`.
- Sponsor manager: advertisers, campaigns, creatives, slots, targeting, deduped impressions and clicks, CSV, shareable report, media upload, advertise lead form.
- Rewards: one free spin a day, bonus spins from streaks and referrals, scratch cards, free giveaways. Prizes are points, boosts, themes, badges, or sponsor vouchers. GiftPort issues vouchers. Redeem codes are encrypted.
- Ops: health checks, structured logs, migrations, seed, admin DAU, registration alerts, daily summary.
- Engagement: full-screen SIX / FOUR / WICKET / FIFTY / HUNDRED / win moments with canvas confetti, a short crowd roar and a mute toggle, XP ranks from Gully Player to Legend, a daily streak with one-day streak freeze, daily and weekly missions, a free season track, fan colours and a live fan meter, break trivia and a 10-over score guess, throttled cheers, and bot nudges. Each of those surfaces has an ad slot: `celebration`, `fan_meter`, `minigame`, `mission`, `season_pass`, `cheer`, `nudge`.
- Play: a pinned live score the bot keeps editing, inline score cards, squads, a late fan vote with a fans-versus-stats card, scrolling comments, earned prediction chips, a prediction streak with a saver and double down, a daily puzzle, a two-pack sticker album, match tickets, a luck index and next-over forecast, a 10-tier weekly league, friend streaks, a moments timeline, a fan XI, Add to home screen, and Share to story. Slots: `live_pin`, `inline_card`, `squad`, `fan_vote`, `danmaku`, `chip`, `pred_streak`, `puzzle`, `album`, `ticket`, `luck`, `league`, `fan_xi`.

## Local setup

Node 20+ and pnpm 10. Postgres and Redis, or Docker.

```bash
cp .env.example .env
pnpm install
pnpm --filter @liveline/shared build
pnpm --filter @liveline/db generate
pnpm --filter @liveline/db exec prisma migrate deploy
pnpm --filter @liveline/db seed
pnpm --filter @liveline/api dev
pnpm --filter @liveline/web dev
```

The API is on port 3001. The mini app is on port 5173 and proxies `/api` and `/ws`.

`TELEGRAM_BOT_TOKEN` in `.env.example` is a fake value containing `MOCK`. InitData signatures use it, and the bot process will not call Telegram. Replace it with the real BotFather token for `@LiveLineProBot` when you deploy.

Docker:

```bash
docker compose up --build
```

Then run migrations from the API container or locally against the published Postgres port.

## Environment

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token. `MOCK` in the value disables outbound Telegram calls. |
| `ADMIN_TELEGRAM_IDS` | Comma-separated numeric ids and `@usernames`, matched without case. Default `8992664481,8860632140`. Both are full admins. |
| `ADMIN_ALERT_CHAT_ID` | Optional extra chat for registration and ops alerts. |
| `CHANNEL_ID` | Auto-post chat. Default `-1004458549838` (`@LiveLine_Pro`). |
| `CHANNEL_USERNAME` | Default `LiveLine_Pro`. Used for the Join button. |
| `WEBAPP_URL` | Public mini app origin. |
| `DATABASE_URL` | Postgres. |
| `REDIS_URL` | Cache, pub/sub, BullMQ, rate limits. |
| `USE_MOCK_PROVIDER` | `true` uses the simulator. |
| `ROANUZ_PROJECT_KEY`, `ROANUZ_API_KEY` | Roanuz Cricket API v5. |
| `ROANUZ_BASE_URL` | Default `https://api.sports.roanuz.com/v5`. |
| `ROANUZ_WS_URL` | Socket.IO host from Roanuz docs. |
| `OPENAI_API_KEY` | Optional. Empty = grounded stub. |
| `USE_MOCK_GIFTPORT` | Default true. |
| `GIFTPORT_CLIENT_ID`, `GIFTPORT_SECRET_ID` | GiftPort credentials. Sent as `clientId` and `secretId` on every call. |
| `GIFTPORT_API_URL` | Default `https://giftport.in/api/giftcard`. |
| `GIFTPORT_PROXY_URL` | Optional HTTP proxy if this process is not on the whitelisted IP. |
| `GIFTPORT_LOW_BALANCE_INR` | Admins are alerted under this balance. Issuing stops when the balance cannot cover the voucher. |
| `REWARDS_ENCRYPTION_KEY` | 32-byte key for redeem codes. Replace the demo value in production. |
| `S3_*` | Optional media bucket. Empty stores uploads on disk. |
| `INTERNAL_SERVICE_TOKEN` | Local-only `/internal/*`. Disabled when `NODE_ENV=production`. |
| `RUN_EMBEDDED_WORKER` | Set `false` on the API service when the worker service is running. |

The app reads these from the environment only. Nothing secret is committed.

## BotFather

1. Open [@BotFather](https://t.me/BotFather) and use the bot `@LiveLineProBot`.
2. `/setdomain` is not required for the menu button. Use `/newapp` if you want the direct link `https://t.me/LiveLineProBot/app`. Short name: `app`. URL: your `WEBAPP_URL`.
3. The bot sets the menu button itself on startup (`Live scores` → `WEBAPP_URL`). You can also set it with `/setmenubutton`.
4. Add the bot as admin of [@LiveLine_Pro](https://t.me/LiveLine_Pro) with permission to post. `CHANNEL_ID` is `-1004458549838`.
5. In groups, `/live` and `/score` reply with the current line. `/start` in a group shares a group-board link.
6. Admins (`ADMIN_TELEGRAM_IDS`) can use `/stats`, `/ads`, and `/broadcast`. Broadcast asks for confirmation. `8992664481` (`@fantzoSportsUpdates`) and `8860632140` (`@Liveline_proadmin`) are both full admins. Usernames still match in any case. The first time that person opens the bot or the mini app, the numeric id is stored, so a later username change still has access. Another account that takes the old username does not. The Admins screen adds and removes admins, sets owner or full admin, and keeps an audit log. The last owner cannot be removed.

Phone verification uses the bot's contact-request keyboard or `WebApp.requestContact`. The server rejects a contact whose `user_id` is not the sender.

## Railway (existing project `betroxy`)

Do not create a new Railway project. GiftPort already whitelists this project's static egress IP. A new project would get a new IP and voucher calls would fail until you whitelist it again.

1. In the `betroxy` project, add services from this repo (or `railway up` while linked to `betroxy`, not a new project).
2. Backend services share `apps/api/Dockerfile` (build context: repo root). Set the start command per service:
   - `liveline-api`: `node apps/api/dist/main.js` and `RUN_EMBEDDED_WORKER=false`
   - `liveline-bot`: `node apps/api/dist/bot.js`
   - `liveline-worker`: `node apps/api/dist/worker.js`
3. Add the web service with `apps/web/Dockerfile`. Set `API_URL` to the public API origin (written into `/config.js` on boot).
4. Plugin Postgres and Redis in the same project. Copy `DATABASE_URL` and `REDIS_URL` into each backend service.
5. Set the variables from the table above. Use the real bot token, Roanuz keys, GiftPort client id and secret, and a fresh `REWARDS_ENCRYPTION_KEY` (`openssl rand -base64 32`).
6. Release command for the API service: `pnpm --filter @liveline/db exec prisma migrate deploy`. That applies `20261001170000_admins` along with the earlier migrations.
7. Confirm the project's static outbound IP is still the one saved in GiftPort → API Settings. If a deploy has to leave that IP, set `GIFTPORT_PROXY_URL` to an HTTP proxy on the whitelisted address.
8. Point BotFather and `WEBAPP_URL` at the web service URL.

Health: API `GET /health` checks Postgres and Redis. Bot and worker listen on `PORT` when `RAILWAY_ENVIRONMENT` is set.

## GiftPort

Base URL `https://giftport.in/api/giftcard`. Every request is POST JSON with `clientId` and `secretId` (GET query params also work; we use POST).

- `POST /catalogue` syncs brands into `GiftCatalogueItem`.
- `POST /balance` is shown on the admin dashboard. A low balance alerts admins. A buy is not attempted when the balance is short.
- `POST /buy` uses our `order_id` as the idempotency key.
- `POST /status` reconciles timeouts. A timed-out buy is marked uncertain and is never re-bought under a new `order_id` until status confirms failure. A confirmed failure can be retried as a new order from the fulfilment log.

Redeem codes and card numbers are AES-256-GCM. The winning user sees them in My Rewards. Admins see them on the fulfilment log.

`USE_MOCK_GIFTPORT=true` (or missing credentials) uses the in-memory provider so the rewards zone runs with no keys.

## Add a sport

`SPORT_MODULES` in `packages/shared/src/cricket.ts` lists cricket as implemented and football and kabaddi as reserved. Implement `MatchProvider` (`loadAll()` returning the shared match state, plus an optional push subscription) and register it in `apps/api/src/feed.ts` next to the mock and Roanuz branches. The mini app already filters on `sport`.

## Add a data provider

Keep HTTP and push calls inside one poller. Clients subscribe to Redis pub/sub; they must not call the vendor themselves.

Roanuz v5, from [their docs](https://www.cricketapi.com/v5/):

- `POST /v5/core/{project_key}/auth/` with `{ "api_key" }` → `rs-token`
- `GET /v5/cricket/{project_key}/featured-matches/`
- `GET /v5/cricket/{project_key}/match/{match_key}/`
- `GET /v5/cricket/{project_key}/match/{match_key}/ball-by-ball/`
- `GET /v5/cricket/{project_key}/match/{match_key}/over-summary/`
- `GET /v5/cricket/{project_key}/tournament/{tournament_key}/points/`
- `GET /v5/cricket/{project_key}/tournament/{tournament_key}/featured-matches-2/`
- `GET /v5/cricket/{project_key}/tournament/{tournament_key}/player/{player_key}/stats/`
- Push: `POST .../match/{match_key}/subscribe/` with `{ "method": "web_socket" }`, then Socket.IO at `http://socket.sports.roanuz.com/cricket` path `/v5/websocket`, event `connect_to_match`, updates on `on_match_update`. Polling stays on as discovery and as the fallback. Respect `cache.max_age` and `ROANUZ_RPS`.

## Privacy

We store Telegram id, name, username, language, and Premium flag because Telegram sends them, plus the phone number only after the user shares it through Telegram's contact request. The privacy notice in the registration screen says this. We do not import a phone book.

## Tests

```bash
pnpm test
```

Covers initData HMAC and staleness, prediction settlement, ad eligibility and dedupe keys, GiftPort response parsing, voucher retry rules, and the simulator.

## Limits

- The home screen has a Join our channel button. It opens `https://t.me/$CHANNEL_USERNAME` (default [@LiveLine_Pro](https://t.me/LiveLine_Pro)). Auto-posts go to `CHANNEL_ID`.
- Big moments play a short roar. Mute is stored on the device. `prefers-reduced-motion` skips the confetti.
- The season track and missions cannot be bought. Streak freeze covers one missed day.
- Players and fans use cartoon SVG avatars (emoji face, jersey, number, role icon). There are no photos. The avatar builder unlocks faces, jerseys, caps, and frames with XP and rewards.
- Chips, streak savers, double downs, sticker packs, and match tickets are earned. They cannot be bought with money or Telegram Stars, and packs are not transferable. Sticker swaps need a duplicate on both sides.
- An age gate asks for a birth year only: 18+, or 13–17 with parental consent under the DPDP Act. Under 13 is refused.
- Sponsor creation rejects betting, real-money gaming, and Stars categories, and any copy that mentions odds.
- The bot pins one live score per group or channel and edits it at most every 5 seconds. Inline mode inserts a score card. `/squad` turns that chat into a squad.
- AI answers are grounded in the live match until `OPENAI_API_KEY` is set.
- GiftPort HTTP calls are implemented. Missing credentials or `USE_MOCK_GIFTPORT=true` uses the mock catalogue and balance.
- Score cards are SVG. A PNG is produced only if `@resvg/resvg-js` is installed.
- Sponsor report links still require Telegram initData. They are not anonymous public URLs.
- The Roanuz mapper follows the v5 docs and has not been verified against a live payload.
- Football and kabaddi are reserved in the sport registry. Only cricket runs.
