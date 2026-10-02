# LiveLinePro public website (`apps/site`)

Server-rendered (Hono on Node, no client framework), mobile-first, neon-on-dark. Reads the live
universe the api/worker poller keeps in Redis (`ll:universe`, fed by Roanuz) — read-only, it never
calls Roanuz itself. Win probability / luck / forecast fields are stripped before rendering.

Routes: `/` home · `/live` live centre · `/match/:key/:slug` ball-by-ball live line + scorecard
(auto-refresh 5 s via `/fragment/match/:key`) · `/schedule` · `/series/:slug` · `/preview/:slug` ·
`/lino` (Lino insights) · `/alerts` · `/about` · `/sitemap.xml` · `/robots.txt` · `/og/*.png` · `/healthz`.

Telegram buttons: `t.me/LiveLineProBot?startapp=web_<page>` (`web_m_<key>` → match, `web_l_<key>` →
Lino for that match; Mini App routes these, CRM buckets them as `website`) and `t.me/LiveLine_Pro`.

## Env
| var | value |
| --- | --- |
| `REDIS_URL` | `${{liveline-redis.REDIS_URL}}` (private network) |
| `SITE_URL` | the bought domain, e.g. `https://livelinepro.in` (Railway hosts are ignored on purpose) |
| `ALLOW_INDEXING` | `true` only once the domain is live (until then robots.txt = Disallow + noindex) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | optional, `${{liveline-api.…}}` — Lino AI take, cached per match+over |
| `BOT_USERNAME`, `CHANNEL_USERNAME` | default `LiveLineProBot`, `LiveLine_Pro` |

## When the domain is bought
1. Railway → betroxy → liveline-site → Settings → Networking → **Custom Domain** → add `livelinepro.in`
   (and `www.livelinepro.in`). Railway shows the records to create at the registrar:
   - subdomain (`www`): `CNAME www → <target>.up.railway.app` (value shown by Railway)
   - apex: `CNAME`/`ALIAS`/`ANAME` flattening to the same target (Cloudflare does CNAME flattening),
   - plus the `_railway-verify` TXT record if Railway asks for it.
   Port: 3000. TLS is issued automatically once DNS resolves.
2. Set `SITE_URL=https://livelinepro.in` and `ALLOW_INDEXING=true` on liveline-site, redeploy.
3. Submit `https://livelinepro.in/sitemap.xml` in Google Search Console / Bing.
4. Optional "Log in with Telegram": BotFather → `/setdomain` for @LiveLineProBot = the domain, then
   add the login widget (needs a server-side hash check with the bot token).

## Phone-verification gate (mandatory entry)
Every page redirects unverified visitors to `/verify?next=<path>` (open without login: `/healthz`,
`/robots.txt`, `/sitemap.xml`, `/og/*`, `/privacy`, `/terms`, `/legal`, static assets; `/fragment/*` → 401).
A verified visitor holds `llp_s`: an httpOnly, Secure (https), SameSite=Lax cookie, HMAC-signed with
`WEB_AUTH_SECRET`, valid 90 days, checked locally (no DB hit). Gated HTML is sent `private` + `Vary: Cookie`.

1. **Verify with Telegram (live)** — `/verify` stores a 15-min nonce in Redis (`ll:wv:n:<nonce>`,
   bound to the browser by the `llp_wv` cookie) and links `t.me/LiveLineProBot?start=webverify_<nonce>`.
   The bot (`/start webverify_…`) logs a verified user in instantly; otherwise the normal phone
   verification (contact share, 18+) runs and on success the nonce is marked verified. The bot replies
   with **↩️ Return to website** → `SITE_URL/verify/t/<signed one-time 15-min token>` (preview host
   until `SITE_URL` is a real https domain; this link is only sent in the private bot chat, never posted
   publicly). Meanwhile `/verify` polls `/verify/tg/status` every 2 s and signs the tab in.
2. **Verify with SMS OTP** — +91 default, 18+ and terms checkboxes, 6-digit code hashed (HMAC) in Redis,
   5-min expiry, 5 wrong tries, 30 s resend, ≤5 sends/h & 10/day per phone, ≤10/h & 30/day per IP,
   40 verify calls/h per IP. On success the site calls `POST /internal/web-auth/sms-verified` on the API
   (60-s signed payload) which finds the user by phone hash or creates one (`source=website`,
   `verifyMethod=sms`, telegramId `web:<id>` — never messaged) and fires the masked admin alert.
   Shown as **Coming soon** until `SMS_PROVIDER` and that provider's values are set.

| var | where | value |
| --- | --- | --- |
| `WEB_AUTH_SECRET` | liveline-site, liveline-api, liveline-bot (same value) | ≥ 32 random chars |
| `SITE_GATE_ENABLED` | liveline-site | default `true`; `false` turns the gate off |
| `API_INTERNAL_URL` | liveline-site | API base for the SMS user upsert |
| `SITE_URL` | liveline-api, liveline-bot | public site origin for "Return to website" (https; falls back to the preview host) |
| `SMS_PROVIDER` | liveline-site | `pearlsms` \| `msg91` \| `fast2sms` (unset = Coming soon) |
| `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID`, `SMS_DLT_ENTITY_ID` | liveline-site | provider credentials + DLT ids |
| `SMS_API_URL`, `SMS_API_METHOD`, `SMS_MESSAGE_TEXT`, `SMS_SUCCESS_MATCH` | liveline-site | PearlSMS URL template (`{apikey} {sender} {mobile} {mobile10} {message} {otp} {templateid} {entityid}`), GET/POST, DLT text (default: SPPLFW OTP template), optional success regex |
