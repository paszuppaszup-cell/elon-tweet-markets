const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const CACHE_TTL_MS = 30000;

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
