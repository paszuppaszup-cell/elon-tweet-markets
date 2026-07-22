# polymarket-tracker-site (website)

Static site (plain HTML/CSS/JS, no build step, no framework) on **GitHub Pages**.
Companion to the Python bot in `../polymarket-bot`.

- **Remote**: `paszuppaszup-cell/elon-tweet-markets`, branch **`master`**
- **Live**: https://paszuppaszup-cell.github.io/elon-tweet-markets/
- **Language**: all user-facing text is **Hungarian**.

## Architecture

- Pages: `index` (markets), `market` (detail), `calculator`, `account`, `recommendations`, `stats`, `news`. Each has a matching `js/<page>.js`.
- `js/api.js` is the **shared library**, loaded first on every page (fetch helpers, `escapeHtml`, `isSafeHttpUrl`, forecast/stats math, Supabase read helpers).
- **Data sources** (all read-only, public): Polymarket Gamma/CLOB/data-api, xtracker.polymarket.com, and **Supabase** (project `azfslxatgwjlrtylzhwd`) via the **anon/publishable key hardcoded in `api.js`** — public by design, protected by RLS.
- The bot writes Supabase (tables `tweet_log`, `news_log`, `news_volume`, `sent_alerts`, `alert_config`, …); the site only reads them. Anything the browser can't fetch directly (GDELT, RSS — CORS/rate-limit) is proxied into Supabase by the bot.

## Golden rules (do these or the site breaks silently)

1. **Cache-busting is mandatory.** GitHub Pages caches assets ~10 min. When you edit a JS or CSS file, bump its `?v=N` in **every** HTML that references it. `api.js` is on all 7 pages — bump it everywhere at once. Pattern:
   `sed -i 's/api\.js?v=16/api.js?v=17/' *.html`
   `css/style.css` also carries `?v=N`. If a change "doesn't show up", it's almost always a missed cache-bust.
2. **Escape all untrusted data before `innerHTML`.** Everything from Polymarket/xtracker/news APIs, URL params, and localStorage is untrusted. Wrap in `escapeHtml()` (in `api.js`). For links (`href`), also gate through `isSafeHttpUrl()` — `escapeHtml` alone does NOT stop `javascript:` URIs. Validate the `market.html?id=` param with `/^\d+$/` and `encodeURIComponent`. This has already caught a real XSS.
3. **Never expose the service_role key** in JS/HTML. Only the anon key belongs here. Writes go through the PIN-gated `update_alert_config` RPC.

## Adding / changing a page

- Copy an existing page's `<head>`/`<nav>` so the nav bar stays identical (7 links: Piacok, Kalkulátor, Fiókom, Javaslatok, Statisztika, Hírek). Add the new link to **every** page's nav.
- Load `js/api.js?v=N` before the page script.
- Reuse `.panel`, `.result-grid`/`.result-card`, `.card`, `.chip`, `.badge`, `.table-scroll`, `.chart-wrap` from `css/style.css` — don't invent new layout primitives.

## Charts (Chart.js, pinned + SRI on `market`/`stats`)

- Wrap every `<canvas>` in `<div class="chart-wrap">` and set `maintainAspectRatio: false`. **Do not** rely on the canvas `height` attribute — on mobile it stays pinned while width shrinks and squishes the chart. `.chart-wrap` gives a CSS-driven height.
- Keep legends single-line on mobile: short labels + `COMPACT_LEGEND` (see `stats.js`).
- CDN `<script>` tags must stay version-pinned with `integrity` + `crossorigin`.

## Verify before pushing (browser preview)

`launch.json` profile name: **`polymarket-tracker-site`** (serves this dir on :5501).
Verify with **DOM inspection via `javascript_tool`**, not just screenshots (screenshots have been flaky). Check `docScrollWidth <= viewportWidth` (no horizontal overflow), chart `overlapPx`, and `read_console_messages onlyErrors:true`. Test **both** desktop and 375px mobile.

## Deploy

Use the **`polymarket-deploy`** skill. Key gotchas: push with `git -C "<abspath>"` (never `cd &&` — the classifier flagged a cd-chained push as targeting the wrong repo). CRLF warnings are benign. After push, poll the live asset with `curl … | grep <new-symbol>` to confirm Pages rebuilt (~30–60s).
