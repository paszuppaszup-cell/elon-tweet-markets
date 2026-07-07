const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const XTRACKER_BASE = "https://xtracker.polymarket.com";
const DATA_API_BASE = "https://data-api.polymarket.com";
const CACHE_TTL_MS = 30000;

// Kulon Supabase projekt (polymarket-elon-tracker), csak ehhez az eszkozhoz.
// A kulcs publikus/publishable - olvasasra barki hasznalhatja, iras csak a
// update_alert_config() fuggvenyen keresztul mukodik, PIN-nel vedve (lasd a
// migraciot). Nincs benne penzugyi/szemelyes adat.
const SUPABASE_URL = "https://azfslxatgwjlrtylzhwd.supabase.co";
const SUPABASE_KEY = "sb_publishable_-MaAb64-e7kfH_vxhSGwwA_zVJLHsjL";

// Minden kulso/ismeretlen forrasbol jovo szoveget (Polymarket piac-cimek,
// sav-cimkek, kimenetek, hibauzenetek, URL-parameterek) EZEN kell atengedni,
// mielott innerHTML-be kerul - kulonben egy tamado, aki letrehoz egy piacot
// pl. "<img src=x onerror=...>" cimmel, JS-t futtathat a latogato bongeszojeben
// (XSS). A " es ' escapelese miatt idezojeles attributumban (pl. data-label="…")
// is biztonsagos. Szamokra (ar, darab) nem kotelezo, de artalmatlan.
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchSharedConfig() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/alert_config?select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) throw new Error(`Supabase HTTP ${resp.status}`);
  const rows = await resp.json();
  return rows[0] || null;
}

async function saveSharedConfig(pin, config) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_alert_config`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_pin: pin,
      p_target_profit: config.targetProfit,
      p_max_hours: config.maxHours,
      p_min_legs: config.minLegs,
      p_max_legs: config.maxLegs,
      p_min_return_pct: config.minReturnPct,
    }),
  });
  if (!resp.ok) throw new Error(`Supabase HTTP ${resp.status}`);
  return resp.json(); // true / false
}

// --- Tweet-naplo / statisztika (stats.html) ---
// A tweet_log tabla Elon Musk osszes ismert posztjanak idobelyeget tarolja
// (a Python tweet-watch bot tolti fel/frissiti 10 percenkent) - ebbol
// epul fel a napi/heti/oraszakos tweet-dinamika statisztika. A PostgREST
// alapertelmezetten max 1000 sort ad vissza kerdesenkent, ezert lapozni
// kell (Range fejlec) az osszes ~10 ezer+ sor lekeresehez.
const TWEET_LOG_CACHE_KEY = "tweet-log-all";
const TWEET_LOG_CACHE_TTL_MS = 300000; // 5 perc - nagy adatmennyiseg, nem kell percenkent ujra

async function fetchAllTweetLog() {
  try {
    const raw = sessionStorage.getItem(TWEET_LOG_CACHE_KEY);
    if (raw) {
      const { t, data } = JSON.parse(raw);
      if (Date.now() - t <= TWEET_LOG_CACHE_TTL_MS) return data;
    }
  } catch (e) {
    /* sessionStorage corrupt/unavailable - csak ujra letoltjuk */
  }

  const pageSize = 1000;
  let offset = 0;
  const all = [];
  for (;;) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tweet_log?select=created_at&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      }
    );
    if (!resp.ok && resp.status !== 206) throw new Error(`Supabase HTTP ${resp.status}`);
    const page = await resp.json();
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  try {
    sessionStorage.setItem(TWEET_LOG_CACHE_KEY, JSON.stringify({ t: Date.now(), data: all }));
  } catch (e) {
    /* sessionStorage full/unavailable - ignore, csak nem cache-eljuk */
  }
  return all;
}

// Napi bontas UTC naptari nap szerint - {dateStr: count}. Csak azok a napok
// szerepelnek, amiken volt legalabb 1 tweet.
function aggregateDailyCounts(entries) {
  const counts = new Map();
  for (const e of entries) {
    const day = e.created_at.slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return counts;
}

// A napi szamlalot folytonos sorozatta egesziti ki (a hianyzo, 0-tweetes
// napokkal is) - igy a grafikonon a csendes idoszakok is lathatoak, nem
// csak azok a napok, amiken tortent valami.
function fillDailySeries(countsMap) {
  const days = [...countsMap.keys()].sort();
  if (!days.length) return [];
  const start = new Date(days[0] + "T00:00:00Z");
  const end = new Date(days[days.length - 1] + "T00:00:00Z");
  const series = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: countsMap.get(key) || 0 });
  }
  return series;
}

function rollingAverage(series, windowDays) {
  const result = [];
  let sum = 0;
  const window = [];
  for (const point of series) {
    window.push(point.count);
    sum += point.count;
    if (window.length > windowDays) sum -= window.shift();
    result.push({ date: point.date, avg: sum / window.length });
  }
  return result;
}

// Atlag tweet/nap a het napjai szerint (UTC, 0=vasarnap...6=szombat) - csak
// a tenylegesen szereplo napokon szamol atlagot (nem torzitja a sorozat elott
// nem letezo idoszak).
function dayOfWeekAverages(series) {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const point of series) {
    const dow = new Date(point.date + "T00:00:00Z").getUTCDay();
    sums[dow] += point.count;
    counts[dow] += 1;
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
}

// Oranankenti (UTC) eloszlas a nyers bejegyzesekbol.
function hourOfDayCounts(entries) {
  const counts = new Array(24).fill(0);
  for (const e of entries) {
    const hour = new Date(e.created_at).getUTCHours();
    counts[hour] += 1;
  }
  return counts;
}

async function fetchSentAlertComboKeys() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/sent_alerts?select=combo_key`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) return new Set();
  const rows = await resp.json();
  return new Set(rows.map((r) => r.combo_key));
}

// Csak a publikus Polygon wallet-cim kell - ez lanc-adat, barki lekerdezheti
// barkinek a cimehez, nem titkos. Nincs sukseg API-kulcsra/private key-re
// olvasashoz, es a site soha nem is fog ilyet kerni.
function isValidPolygonAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test((addr || "").trim());
}

async function fetchPortfolioValue(address) {
  const data = await fetchJson(`${DATA_API_BASE}/value?user=${address}`, `value-${address}`);
  return (data && data[0] && data[0].value) || 0;
}

async function fetchPositions(address) {
  return fetchJson(`${DATA_API_BASE}/positions?user=${address}`, `positions-${address}`);
}

async function fetchUserTrades(address, limit = 30) {
  return fetchJson(`${DATA_API_BASE}/trades?user=${address}&limit=${limit}`, `trades-${address}`);
}

// xtracker.polymarket.com az a hivatalos "Post Counter" forras, amit Polymarket
// maga hasznal e piacok elszamolasahoz (lasd a piac leirasaban a resolutionSource
// mezot). Nem harmadik feles scraping - ugyanaz a nyilvanos, CORS-nyitott API,
// amit a sajat oldaluk is hasznal.
let elonPostsCache = null;
let elonPostsFetchedAt = 0;
const ELON_POSTS_TTL_MS = 120000;

async function fetchElonPosts() {
  if (elonPostsCache && Date.now() - elonPostsFetchedAt < ELON_POSTS_TTL_MS) {
    return elonPostsCache;
  }
  const resp = await fetch(`${XTRACKER_BASE}/api/users/elonmusk/posts`);
  if (!resp.ok) throw new Error(`xtracker HTTP ${resp.status}`);
  const data = await resp.json();
  elonPostsCache = data.data || [];
  elonPostsFetchedAt = Date.now();
  return elonPostsCache;
}

// A Gamma esemeny startDate/endDate mezoje NEM ugyanaz, mint a tenyleges
// tweet-szamlalasi ablak (a gamma datum a piac kereskedesi megnyitasat/zarasat
// jeloli, ami korabban nyilik es kesobb zar, mint a szamlalt idoszak). A
// xtracker "tracking" rekordja tartalmazza a pontos, hivatalos szamlalasi
// ablakot ugyanazzal a cimmel, mint a Polymarket esemeny - ezt kell hasznalni.
async function fetchElonTrackings() {
  const data = await fetchJson(`${XTRACKER_BASE}/api/users/elonmusk`, "elon-user");
  return (data.data && data.data.trackings) || [];
}

function findTrackingWindow(trackings, eventTitle) {
  const match = trackings.find((t) => t.title === eventTitle);
  return match ? { startDate: match.startDate, endDate: match.endDate } : null;
}

// A havi ("Elon Musk # tweets in July 2026?") eseményekhez az xtracker NEM
// vezet kulon "tracking" rekordot (csak a heti/rovidebb ablakokat koveti),
// szoval ilyenkor a cimbol szamoljuk ki a naptari honap hataraiat. A
// Polymarket ezeket a piacokat megfigyelheto modon UTC-4 (ET) eltolassal
// definialja (lasd a heti ablakok pontos xtracker idobelyegeit) - ugyanazt
// az eltolast hasznaljuk itt is. Kevesbe pontos, mint a heti xtracker
// tracking, de jo becsles, ha nincs mas forras.
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseMonthlyWindowFromTitle(title) {
  const match = (title || "").toLowerCase().match(/in (\w+) (\d{4})/);
  if (!match) return null;
  const monthIdx = MONTH_NAMES.indexOf(match[1]);
  if (monthIdx === -1) return null;
  const year = parseInt(match[2], 10);
  const start = new Date(Date.UTC(year, monthIdx, 1, 4, 0, 0));
  const end = new Date(Date.UTC(year, monthIdx + 1, 1, 3, 59, 59));
  return { startDate: start.toISOString(), endDate: end.toISOString(), estimated: true };
}

function countPostsInWindow(posts, startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return posts.reduce((n, p) => {
    const t = new Date(p.createdAt).getTime();
    return t >= start && t <= end ? n + 1 : n;
  }, 0);
}

// Osszevonja a fenti xtracker segedeket egyetlen "hol tart most ez az
// esemeny" allapotba - a market.html, index.html es recommendations.html
// is ezt hasznalja.
function computeEventLiveState(event, posts, trackings) {
  let window_ = findTrackingWindow(trackings, event.title);
  if (!window_) window_ = parseMonthlyWindowFromTitle(event.title);
  if (!window_) return null;

  const count = countPostsInWindow(posts, window_.startDate, window_.endDate);
  const daysRemaining = (new Date(window_.endDate).getTime() - Date.now()) / 86400000;
  const daysElapsed = (Date.now() - new Date(window_.startDate).getTime()) / 86400000;
  const currentPace = daysElapsed > 0 ? count / daysElapsed : null;
  return { count, daysRemaining, daysElapsed, currentPace };
}

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL_MS) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function cacheSet(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch (e) {
    /* sessionStorage full or unavailable - ignore */
  }
}

async function fetchJson(url, cacheKey) {
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} - ${url}`);
  const data = await resp.json();
  if (cacheKey) cacheSet(cacheKey, data);
  return data;
}

async function searchElonTweetEvents() {
  const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent("elon musk # tweets")}&limit_per_type=25&events_status=active`;
  const data = await fetchJson(url, "elon-events-list");
  return (data.events || []).filter(
    (e) => e.active && !e.closed && (e.title || "").toLowerCase().startsWith("elon musk # tweets")
  );
}

async function fetchEventById(id) {
  const url = `${GAMMA_BASE}/events/${encodeURIComponent(id)}`;
  return fetchJson(url, `event-${id}`);
}

function parseJsonField(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return [];
    }
  }
  return value || [];
}

function normalizeMarket(raw) {
  const outcomes = parseJsonField(raw.outcomes);
  const tokenIds = parseJsonField(raw.clobTokenIds);
  const prices = parseJsonField(raw.outcomePrices).map(Number);
  return {
    id: raw.id,
    question: raw.question,
    groupItemTitle: raw.groupItemTitle || null,
    outcomes,
    tokenIds,
    prices,
    volume: Number(raw.volume || 0),
    liquidity: Number(raw.liquidity || 0),
    active: raw.active,
    closed: raw.closed,
  };
}

async function fetchPriceHistory(tokenId, interval = "1w", fidelity = 60) {
  const url = `${CLOB_BASE}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`;
  const data = await fetchJson(url, `history-${tokenId}-${interval}`);
  return data.history || [];
}

function isWeeklyRangeEvent(event) {
  return (event.title || "").includes(" - ");
}

// "160-179" -> {min:160,max:179}; "<40" -> {min:0,max:39}; "500+" -> {min:500,max:Infinity}
// --- Pozicio-ertekelo statisztikai modell (lasd polybot/stats.py +
// polybot/strategies/position_watch.py - ugyanaz a matek mindket oldalon) ---
// A tweetek erkezeset Poisson-folyamatnak tekintjuk egy naponkenti rataval:
// megbecsuljuk, mekkora esellyel esik a VEGSO tweet-szam a tartott sávba, es
// ezt osszevetjuk a jelenlegi piaci arral (amennyiert most el lehetne adni).
// Ha a modell-becsult nyeresi esely lenyegesen a piaci ar alatt van,
// statisztikailag jobban jarsz, ha most zarod le a poziciot.
const POSITION_WATCH_RECENT_WINDOW_DAYS = 3.0;
const POSITION_WATCH_MIN_VALUE_USD = 1;
const POSITION_WATCH_MIN_PRICE_GAP = 0.07;
const POSITION_WATCH_MIN_EDGE_USD = 3;
const _POISSON_EXACT_LIMIT = 30;

function _erf(x) {
  // Abramowitz-Stegun 7.1.26 kozelites, kb. 1.5e-7 max hibaval.
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + _erf(x / Math.sqrt(2)));
}

function poissonCdf(k, lam) {
  if (k < 0) return 0;
  if (lam <= 0) return 1;
  if (lam > _POISSON_EXACT_LIMIT) {
    const z = (k + 0.5 - lam) / Math.sqrt(lam);
    return Math.min(Math.max(normCdf(z), 0), 1);
  }
  let p = Math.exp(-lam);
  let cdf = p;
  for (let i = 1; i <= k; i++) {
    p *= lam / i;
    cdf += p;
    if (cdf >= 1 - 1e-12) break;
  }
  return Math.min(cdf, 1);
}

function probCountInRange(currentCount, remainingMean, lo, hi) {
  const neededLo = Math.max(0, lo - currentCount);
  if (hi === null || hi === undefined || hi === Infinity) {
    return 1 - poissonCdf(neededLo - 1, remainingMean);
  }
  const neededHi = hi - currentCount;
  if (neededHi < 0) return 0;
  return poissonCdf(neededHi, remainingMean) - poissonCdf(neededLo - 1, remainingMean);
}

const _BUCKET_RANGE_RE = /post\s+(\d+)\s*-\s*(\d+)\s+tweets/i;
const _BUCKET_UNDER_RE = /post\s+<\s*(\d+)\s+tweets/i;
const _BUCKET_PLUS_RE = /post\s+(\d+)\s*\+\s+tweets/i;

// Egy pozicio 'title' mezojebol (pl. 'Will Elon Musk post 120-139 tweets
// from June 16 to June 23, 2026?') kinyeri a sav hatarait: {lo, hi}, hi=null
// ha nyitott felso hatar (pl. '500+'). null, ha nem felismerheto tweet-cim.
function parseBucketFromTitle(title) {
  title = title || "";
  let m = title.match(_BUCKET_RANGE_RE);
  if (m) return { lo: parseInt(m[1], 10), hi: parseInt(m[2], 10) };
  m = title.match(_BUCKET_UNDER_RE);
  if (m) return { lo: 0, hi: parseInt(m[1], 10) - 1 };
  m = title.match(_BUCKET_PLUS_RE);
  if (m) return { lo: parseInt(m[1], 10), hi: null };
  return null;
}

function estimateDailyRate(posts, windowStartIso, nowMs, currentCount, daysElapsed) {
  if (daysElapsed <= 0) return 0;
  const paceFull = currentCount / daysElapsed;

  const windowStartMs = new Date(windowStartIso).getTime();
  const recentStartMs = Math.max(windowStartMs, nowMs - POSITION_WATCH_RECENT_WINDOW_DAYS * 86400000);
  const recentSpanDays = (nowMs - recentStartMs) / 86400000;
  if (recentSpanDays <= 0) return paceFull;

  const recentCount = countPostsInWindow(posts, new Date(recentStartMs).toISOString(), new Date(nowMs).toISOString());
  const paceRecent = recentCount / recentSpanDays;
  const weight = Math.min(1, recentSpanDays / POSITION_WATCH_RECENT_WINDOW_DAYS);
  return weight * paceRecent + (1 - weight) * paceFull;
}

// Egy nyitott poziciohoz visszaadja a modell-ertekelest, vagy null-t, ha nem
// modellezheto (nem felismerheto sav-cim, nincs xtracker/naptari ablak,
// vagy mar nincs hatralevo ido).
function evaluatePositionModel(position, eventTitle, posts, trackings, nowMs) {
  const bucket = parseBucketFromTitle(position.title);
  if (!bucket) return null;

  let window_ = findTrackingWindow(trackings, eventTitle);
  if (!window_) window_ = parseMonthlyWindowFromTitle(eventTitle);
  if (!window_) return null;

  const endMs = new Date(window_.endDate).getTime();
  const startMs = new Date(window_.startDate).getTime();
  const daysRemaining = (endMs - nowMs) / 86400000;
  const daysElapsed = (nowMs - startMs) / 86400000;
  if (daysRemaining <= 0) return null;

  const currentCount = countPostsInWindow(posts, window_.startDate, window_.endDate);
  const dailyRate = estimateDailyRate(posts, window_.startDate, nowMs, currentCount, daysElapsed);
  const remainingMean = dailyRate * daysRemaining;

  const modelPYes = probCountInRange(currentCount, remainingMean, bucket.lo, bucket.hi);
  const outcome = (position.outcome || "Yes").trim().toLowerCase();
  let modelP = outcome === "yes" ? modelPYes : 1 - modelPYes;
  modelP = Math.min(Math.max(modelP, 0), 1);

  const curPrice = Number(position.curPrice) || 0;
  const size = Number(position.size) || 0;
  const currentValue = Number(position.currentValue) || size * curPrice;
  const expectedValueIfHold = size * modelP;
  const edgeUsd = currentValue - expectedValueIfHold;

  const signal =
    currentValue >= POSITION_WATCH_MIN_VALUE_USD &&
    curPrice - modelP >= POSITION_WATCH_MIN_PRICE_GAP &&
    edgeUsd >= POSITION_WATCH_MIN_EDGE_USD;

  return {
    lo: bucket.lo,
    hi: bucket.hi,
    currentCount,
    daysRemaining,
    dailyRate,
    modelP,
    curPrice,
    currentValue,
    expectedValueIfHold,
    edgeUsd,
    signal,
  };
}

// Az adott cim MINDEN nyitott poziciojanak (redeemable===false) ertekeleset
// visszaadja egy {asset: evaluation} Map-kent - a nem-Elon vagy nem
// ertelmezheto piacokat/pozokat csendben kihagyja.
async function evaluateOpenPositions(positions) {
  const candidates = positions
    .map((p) => ({ position: p, bucket: parseBucketFromTitle(p.title) }))
    .filter((c) => c.bucket);
  if (!candidates.length) return new Map();

  const [posts, trackings] = await Promise.all([fetchElonPosts(), fetchElonTrackings()]);

  const eventIds = [...new Set(candidates.map((c) => c.position.eventId).filter(Boolean))];
  const eventTitles = new Map();
  await Promise.all(
    eventIds.map(async (id) => {
      try {
        const event = await fetchEventById(id);
        eventTitles.set(id, event && event.title);
      } catch (e) {
        /* nem sikerult lekerni ezt az eventet - a hozza tartozo pozit kihagyjuk */
      }
    })
  );

  const nowMs = Date.now();
  const results = new Map();
  for (const { position } of candidates) {
    const eventTitle = eventTitles.get(position.eventId);
    if (!eventTitle) continue;
    const evaluation = evaluatePositionModel(position, eventTitle, posts, trackings, nowMs);
    if (evaluation) results.set(position.asset, evaluation);
  }
  return results;
}

function parseBucketRange(label) {
  const clean = (label || "").trim();
  if (clean.endsWith("+")) {
    return { min: parseInt(clean, 10), max: Infinity };
  }
  if (clean.startsWith("<")) {
    return { min: 0, max: parseInt(clean.slice(1), 10) - 1 };
  }
  const parts = clean.split("-").map((n) => parseInt(n, 10));
  if (parts.length === 2 && !parts.some(isNaN)) {
    return { min: parts[0], max: parts[1] };
  }
  return null;
}
