# Ads manager (Admin → 🖼 Ads)

Admins upload and schedule ads for the **website** (`apps/site`) and the **Mini App** (`apps/web`).
The 💚 Sponsors tab is unchanged; this is a separate inventory.

## Ad types
| Type | Content | Where |
|---|---|---|
| Banner | image (one default + optional per-size overrides) | site + Mini App |
| Native | image + title + text + CTA | site + Mini App |
| Video | mp4/webm (≤ 20 MB) + poster, autoplay muted loop | site + Mini App |
| HTML / script | ad-network code (AdSense etc.) rendered raw | **website only** |

Images ≤ 3 MB (png/jpg/webp/gif). Form note: “Use legal brands only.” (no blocklist code by design).

## Placements
`site_|app_` × `top` (leaderboard 728×90 / 320×100), `infeed` (1200×628), `sticky` (bottom, closable), `interstitial`
(fullscreen, 3 s close timer, per-user/day frequency cap). Screens: home, match, schedule, lino (none = all).
The Mini App has no separate schedule screen, so “schedule” maps to the bottom in-feed slot on Home.

Selection: highest priority wins; equal priority rotates by weight. Start/end window + active toggle.
Links: “In-app” opens inside the Mini App (iframe when the target allows framing, otherwise Telegram's in-app browser);
“Browser” opens externally. On the site, external links open in a new tab with `rel="sponsored noopener"`.

## Storage
Uploads go to the private Railway bucket **liveline-ads** (project BETROXY) via `ADS_S3_*` variables on
liveline-api and liveline-site (references to the bucket's ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY).
Files are always served from our own paths (`/ads-media/<file>` on the api and the site, Range/206 supported) —
bucket URLs never appear in pages. Without `ADS_S3_*` the api falls back to local disk (dev only).

## Tracking
Impressions (≥ 50 % visible, deduped 20 s per viewer) and clicks are counted in Redis (`ll:adstat`) by the api
(`POST /api/adunits/:id/event`) and the site (`POST /ad/ev`, `GET /ad/go/:id`), then flushed every 30 s into
`AdUnitStat` (day × surface × placement × page). Admin → Reports shows totals per ad with CSV
(`/api/admin/adunits/report.csv?days=N`).
