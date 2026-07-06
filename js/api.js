const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const XTRACKER_BASE = "https://xtracker.polymarket.com";
const DATA_API_BASE = "https://data-api.polymarket.com";
const CACHE_TTL_MS = 30000;

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
