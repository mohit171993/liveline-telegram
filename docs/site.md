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
