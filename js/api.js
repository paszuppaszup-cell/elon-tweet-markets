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

function countPostsInWindow(posts, startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return posts.reduce((n, p) => {
    const t = new Date(p.createdAt).getTime();
    return t >= start && t <= end ? n + 1 : n;
  }, 0);
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
  const url = `${GAMMA_BASE}/events/${id}`;
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
