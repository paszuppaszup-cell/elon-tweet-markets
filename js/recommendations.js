const REFRESH_MS = 60000;
const BEST_PICK_REFRESH_MS = 600000; // 10 perc
const WALLET_STORAGE_KEY = "polymarket_wallet_address"; // ugyanaz, mint account.js
const PACE_SEGMENTS_KEY = "pace_scenario_segments";
const PACE_SEGMENTS = Array.from({ length: 8 }, (_, i) => ({
  lo: i * 5,
  hi: i * 5 + 5,
  label: `${i * 5}-${i * 5 + 5}`,
}));
const DEFAULT_CONFIG = {
  targetProfit: 20,
  maxHours: 48,
  minLegs: 2,
  maxLegs: 8,
  minReturnPct: 10,
};

const recList = document.getElementById("recList");
const statusEl = document.getElementById("statusText");
const cfgErrorBox = document.getElementById("cfgErrorBox");
const configSourceNote = document.getElementById("configSourceNote");

let currentConfig = { ...DEFAULT_CONFIG };
let alertedComboKeys = new Set();

function rowToConfig(row) {
  return {
    targetProfit: Number(row.target_profit),
    maxHours: Number(row.max_hours),
    minLegs: Number(row.min_legs),
    maxLegs: Number(row.max_legs),
    minReturnPct: Number(row.min_return_pct),
    updatedAt: row.updated_at,
  };
}

function readConfigForm() {
  return {
    targetProfit: parseFloat(document.getElementById("cfgProfit").value) || DEFAULT_CONFIG.targetProfit,
    maxHours: parseFloat(document.getElementById("cfgMaxHours").value) || DEFAULT_CONFIG.maxHours,
    minLegs: parseInt(document.getElementById("cfgMinLegs").value, 10) || DEFAULT_CONFIG.minLegs,
    maxLegs: parseInt(document.getElementById("cfgMaxLegs").value, 10) || DEFAULT_CONFIG.maxLegs,
    minReturnPct: parseFloat(document.getElementById("cfgMinReturn").value) ?? DEFAULT_CONFIG.minReturnPct,
  };
}

function fillConfigForm(config) {
  document.getElementById("cfgProfit").value = config.targetProfit;
  document.getElementById("cfgMaxHours").value = config.maxHours;
  document.getElementById("cfgMinLegs").value = config.minLegs;
  document.getElementById("cfgMaxLegs").value = config.maxLegs;
  document.getElementById("cfgMinReturn").value = config.minReturnPct;
}

function bucketLabel(b) {
  return b.groupItemTitle || b.outcomes[0] || b.question;
}

function hoursUntil(isoDate) {
  return (new Date(isoDate).getTime() - Date.now()) / 3600000;
}

function loadBucketsFromEvent(event) {
  const buckets = (event.markets || [])
    .filter((m) => m.active && !m.closed)
    .map(normalizeMarket)
    .filter((m) => m.tokenIds.length && m.prices.length)
    .map((m) => ({
      tokenId: m.tokenIds[0],
      outcome: m.outcomes[0],
      label: m.groupItemTitle || m.outcomes[0],
      price: m.prices[0],
    }));
  buckets.sort((a, b) => b.price - a.price);
  return buckets;
}

function greedyCombo(buckets, maxLegs) {
  const combo = [];
  let total = 0;
  for (const b of buckets) {
    if (combo.length >= maxLegs) break;
    if (total + b.price >= 1) continue;
    combo.push(b);
    total += b.price;
  }
  return { combo, total };
}

function computeOpportunity(event, config) {
  const hours = hoursUntil(event.endDate);
  if (hours <= 0 || hours > config.maxHours) return null;

  const buckets = loadBucketsFromEvent(event);
  if (buckets.length < config.minLegs) return null;

  const { combo, total } = greedyCombo(buckets, config.maxLegs);
  if (combo.length < config.minLegs || total >= 1) return null;

  const profit = config.targetProfit;
  const shares = profit / (1 - total);
  const totalStake = shares * total;
  if (!isFinite(totalStake) || totalStake <= 0) return null;

  const returnPct = (profit / totalStake) * 100;
  if (returnPct < config.minReturnPct) return null;

  const stakes = combo.map((b) => ({ ...b, stake: shares * b.price }));
  const comboKey = event.id + ":" + [...combo.map((b) => b.tokenId)].sort().join(",");
  const alreadyAlerted = alertedComboKeys.has(comboKey);

  return { event, hours, stakes, sumPrice: total, totalStake, shares, profit, returnPct, alreadyAlerted };
}

function renderOpportunity(opp) {
  const rows = opp.stakes
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.label)}</td>
        <td>${(s.price * 100).toFixed(1)}c</td>
        <td>${fmtUsd(s.stake)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="card" style="cursor:default;">
      <div class="card-head">
        <h3><a href="market.html?id=${encodeURIComponent(opp.event.id)}" style="color:inherit;">${escapeHtml(opp.event.title)}</a></h3>
        <span class="badge">${opp.hours.toFixed(1)} óra a zárásig</span>
      </div>
      ${opp.alreadyAlerted ? '<p style="font-size:12px;color:var(--yellow);margin:6px 0 0;">Erről már ment Telegram-értesítés</p>' : ""}
      <table style="margin-top:10px;">
        <thead><tr><th>Sáv</th><th>Ár</th><th>Tét</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="result-grid" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
        <div class="result-card">
          <div class="label">Összes tét</div>
          <div class="value">${fmtUsd(opp.totalStake)}</div>
        </div>
        <div class="result-card">
          <div class="label">Cél profit</div>
          <div class="value" style="color:var(--green);">${fmtUsd(opp.profit)}</div>
        </div>
        <div class="result-card">
          <div class="label">Megtérülés</div>
          <div class="value">${opp.returnPct.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  `;
}

function fmtUsd(n) {
  return "$" + n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// A "legjobb" javaslat a teljes fiok-egyenleget osztja szet arra a
// kombinaciora, amelyiknel a legvalószínűbb, hogy valamelyik sav bejon -
// DE csak addig gyujt hozza tovabbi savokat, amig a garantalt megterules
// (1/sumPrice - 1) el nem eri a "Min. megterules %" beallitast. Enelkul a
// mohomod simán 100%-hoz kozeli esellyel, de kb. 0% profittal talalna
// "legjobb" kombinaciot (minel tobb savot vonsz be, annal kisebb a profit-
// resz) - az uj hatar biztositja, hogy a valasztott esely+profit par
// tenyleg ertelmes novekedest igerjen, nem csak "biztos nullat".
function greedyComboWithReturnFloor(buckets, maxLegs, minReturnPct) {
  const maxSum = 1 / (1 + minReturnPct / 100);
  const combo = [];
  let total = 0;
  for (const b of buckets) {
    if (combo.length >= maxLegs) break;
    if (total + b.price > maxSum) continue;
    combo.push(b);
    total += b.price;
  }
  return { combo, total };
}

function findBestPickCandidate(events, config) {
  const candidates = events
    .map((event) => {
      const hours = hoursUntil(event.endDate);
      if (hours <= 0 || hours > config.maxHours) return null;

      const buckets = loadBucketsFromEvent(event);
      if (buckets.length < config.minLegs) return null;

      const { combo, total } = greedyComboWithReturnFloor(buckets, config.maxLegs, config.minReturnPct);
      if (combo.length < config.minLegs || total <= 0) return null;

      return { event, hours, combo, sumPrice: total };
    })
    .filter(Boolean)
    .sort((a, b) => b.sumPrice - a.sumPrice);

  return candidates[0] || null;
}

function renderBestPick(best, accountValue) {
  const box = document.getElementById("bestPickBox");
  if (!best) {
    box.innerHTML = '<p class="muted">Jelenleg nincs megfelelő kombináció a beállított feltételekkel (max óra, min/max sáv) — próbáld lazítani a "Beállítások" panelben.</p>';
    return;
  }
  if (!accountValue || accountValue <= 0) {
    box.innerHTML = '<p class="muted">A fiók egyenlege $0 vagy nem elérhető ezen a címen, nincs mit befektetni.</p>';
    return;
  }

  const totalStake = accountValue;
  const shares = totalStake / best.sumPrice;
  const profit = shares - totalStake;
  const multiple = shares / totalStake;

  const rows = best.combo
    .map(
      (b) => `
      <tr>
        <td>${escapeHtml(b.label)}</td>
        <td>${(b.price * 100).toFixed(1)}c</td>
        <td>${fmtUsd(shares * b.price)}</td>
      </tr>`
    )
    .join("");

  box.innerHTML = `
    <div class="card-head">
      <h3><a href="market.html?id=${encodeURIComponent(best.event.id)}" style="color:inherit;">${escapeHtml(best.event.title)}</a></h3>
      <span class="badge">${best.hours.toFixed(1)} óra a zárásig</span>
    </div>
    <p class="muted" style="font-size:13px;">
      Fiók egyenleg: <b>${fmtUsd(accountValue)}</b> ·
      Együttes esély (a kiválasztott sávok): <b>${(best.sumPrice * 100).toFixed(1)}%</b>
    </p>
    <table style="margin-top:10px;">
      <thead><tr><th>Sáv</th><th>Ár</th><th>Ennyit tegyél be</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="result-grid" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
      <div class="result-card">
        <div class="label">Teljes tét (a fiók egyenlege)</div>
        <div class="value">${fmtUsd(totalStake)}</div>
      </div>
      <div class="result-card">
        <div class="label">Kifizetés, ha bejön</div>
        <div class="value">${fmtUsd(shares)}</div>
      </div>
      <div class="result-card">
        <div class="label">Profit, ha bejön</div>
        <div class="value" style="color:var(--green);">${fmtUsd(profit)}</div>
      </div>
      <div class="result-card">
        <div class="label">Szorzó</div>
        <div class="value">${multiple.toFixed(2)}×</div>
      </div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:10px;">Utolsó frissítés: ${new Date().toLocaleTimeString("hu-HU")}</p>
  `;
}

function getStoredWalletAddress() {
  return localStorage.getItem(WALLET_STORAGE_KEY) || "";
}

async function refreshBestPick() {
  const address = getStoredWalletAddress();
  const box = document.getElementById("bestPickBox");
  const errorBox = document.getElementById("bestErrorBox");
  errorBox.innerHTML = "";

  if (!address) {
    box.innerHTML = '<p class="muted">Add meg a wallet-címed a fiók-alapú ajánláshoz.</p>';
    return;
  }

  box.innerHTML = '<p class="loading">Betöltés...</p>';
  try {
    const [value, events] = await Promise.all([fetchPortfolioValue(address), searchElonTweetEvents()]);
    const best = findBestPickCandidate(events, currentConfig);
    renderBestPick(best, value);
  } catch (e) {
    errorBox.innerHTML = `<div class="error-box">Hiba: ${escapeHtml(e.message)}</div>`;
  }
}

// --- Napi tweet-tempo szcenariok (minden aktiv piacra) ---

function loadSelectedPaceSegments() {
  try {
    const raw = JSON.parse(localStorage.getItem(PACE_SEGMENTS_KEY) || "[]");
    return new Set(raw);
  } catch (e) {
    return new Set();
  }
}

function saveSelectedPaceSegments(set) {
  localStorage.setItem(PACE_SEGMENTS_KEY, JSON.stringify([...set]));
}

let selectedPaceSegments = loadSelectedPaceSegments();

function renderPaceSegmentChips() {
  const container = document.getElementById("paceSegments");
  container.innerHTML = PACE_SEGMENTS.map(
    (seg) => `
    <label class="chip chip-toggle ${selectedPaceSegments.has(seg.label) ? "checked" : ""}" data-segment="${seg.label}">
      <input type="checkbox" ${selectedPaceSegments.has(seg.label) ? "checked" : ""}>
      ${seg.label} tweet/nap
    </label>`
  ).join("");

  container.querySelectorAll(".chip-toggle").forEach((chip) => {
    chip.querySelector("input").addEventListener("change", (e) => {
      const segLabel = chip.dataset.segment;
      if (e.target.checked) {
        selectedPaceSegments.add(segLabel);
      } else {
        selectedPaceSegments.delete(segLabel);
      }
      chip.classList.toggle("checked", e.target.checked);
      saveSelectedPaceSegments(selectedPaceSegments);
      refreshPaceScenarios();
    });
  });
}

// Egyenlo-reszveny elosztas (ugyanaz a matek, mint a kalkulatorban/legjobb
// ajanlatban) - adott sav-halmazra, adott befektetheto osszegre.
function computeStakeDistribution(buckets, accountValue) {
  const sumPrice = buckets.reduce((a, b) => a + b.price, 0);
  if (sumPrice <= 0 || sumPrice >= 1) return null;
  const shares = accountValue / sumPrice;
  const profit = shares - accountValue;
  return {
    sumPrice,
    shares,
    profit,
    stakes: buckets.map((b) => ({ ...b, stake: shares * b.price })),
  };
}

function renderPaceEntry(entry) {
  const { event, liveState, segmentLabels, dist, matches, sumPrice } = entry;
  const rows = (dist ? dist.stakes : matches)
    .map(
      (b) => `
      <tr>
        <td>${escapeHtml(b.label)}</td>
        <td>${(b.price * 100).toFixed(1)}c</td>
        <td>${dist ? fmtUsd(b.stake) : "–"}</td>
      </tr>`
    )
    .join("");

  const profitPerDay = dist ? dist.profit / liveState.daysRemaining : null;

  let profitBlock;
  if (!dist && sumPrice >= 1) {
    profitBlock = `<p class="muted" style="margin-top:10px;">Ez a ${matches.length} sáv együtt már ${(sumPrice * 100).toFixed(1)} centet ér — nincs garantált profit ennyi sávval egyszerre.</p>`;
  } else if (!dist) {
    profitBlock = '<p class="muted" style="margin-top:10px;">Linkeld a wallet-címed a "Legjobb ajánlat" panelnél a profit-számításhoz.</p>';
  } else {
    profitBlock = `
      <div class="result-grid" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
        <div class="result-card">
          <div class="label">Profit, ha bármelyik bejön</div>
          <div class="value" style="color:var(--green);">${fmtUsd(dist.profit)}</div>
        </div>
        <div class="result-card">
          <div class="label">Nap (a piac zárásáig)</div>
          <div class="value">${liveState.daysRemaining.toFixed(1)}</div>
        </div>
        <div class="result-card">
          <div class="label">Profit/nap</div>
          <div class="value" style="color:var(--accent);">${fmtUsd(profitPerDay)}</div>
        </div>
      </div>`;
  }

  return `
    <div class="card" style="cursor:default;">
      <div class="card-head">
        <h3><a href="market.html?id=${encodeURIComponent(event.id)}" style="color:inherit;">${escapeHtml(event.title)}</a></h3>
        <span class="badge">${liveState.daysRemaining.toFixed(1)} nap van hátra</span>
      </div>
      <p class="muted" style="font-size:13px;">
        Jelenleg <b>${liveState.count}</b> tweetnél tart, <b>${liveState.daysElapsed.toFixed(2)} nap</b> telt el eddig ·
        eddigi átlag:
        <b>${liveState.currentPace !== null ? liveState.currentPace.toFixed(1) + " tweet/nap" : "n/a (most kezdődött)"}</b> ·
        Szcenáriók: napi <b>${escapeHtml(segmentLabels.join(", "))}</b> tweet
      </p>
      <table style="margin-top:10px;">
        <thead><tr><th>Sáv</th><th>Ár</th><th>Tét</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${profitBlock}
    </div>
  `;
}

async function refreshPaceScenarios() {
  const listEl = document.getElementById("paceScenarioList");
  const segments = PACE_SEGMENTS.filter((seg) => selectedPaceSegments.has(seg.label));

  if (!segments.length) {
    listEl.innerHTML = '<p class="muted">Válassz ki legalább egy napi tempó-sávot fent.</p>';
    return;
  }

  const address = getStoredWalletAddress();
  listEl.innerHTML = '<p class="loading">Betöltés...</p>';
  try {
    const [events, posts, trackings, accountValue] = await Promise.all([
      searchElonTweetEvents(),
      fetchElonPosts(),
      fetchElonTrackings(),
      address ? fetchPortfolioValue(address) : Promise.resolve(null),
    ]);

    const entries = [];
    for (const event of events) {
      const liveState = await computeEventLiveState(event, posts, trackings);
      if (!liveState || liveState.daysRemaining <= 0) continue;

      const buckets = loadBucketsFromEvent(event)
        .map((b) => ({ ...b, range: parseBucketRange(b.label) }))
        .filter((b) => b.range);

      // Az osszes kijelolt szegmens altal erintett savot EGYUTT kezeljuk -
      // egy kombinalt tetkent (mint a kalkulatorban), nem kulon-kulon a
      // teljes egyenleggel szegmensenkent (az fizikailag ertelmetlen lenne,
      // hiszen ugyanazt a penzt tobbszor nem lehet betenni).
      const matchedMap = new Map();
      const matchedSegmentLabels = [];
      for (const seg of segments) {
        const projLo = liveState.count + seg.lo * liveState.daysRemaining;
        const projHi = liveState.count + seg.hi * liveState.daysRemaining;
        const segMatches = buckets.filter((b) => b.range.max >= projLo && b.range.min <= projHi);
        if (segMatches.length) matchedSegmentLabels.push(seg.label);
        segMatches.forEach((b) => matchedMap.set(b.tokenId, b));
      }
      if (!matchedMap.size) continue;

      const matches = [...matchedMap.values()].sort((a, b) => a.range.min - b.range.min);
      const sumPrice = matches.reduce((a, b) => a + b.price, 0);
      const dist = accountValue ? computeStakeDistribution(matches, accountValue) : null;

      entries.push({ event, liveState, segmentLabels: matchedSegmentLabels, matches, dist, sumPrice });
    }

    entries.sort((a, b) => {
      const pa = a.dist ? a.dist.profit / a.liveState.daysRemaining : -Infinity;
      const pb = b.dist ? b.dist.profit / b.liveState.daysRemaining : -Infinity;
      return pb - pa;
    });

    const notice = !address
      ? '<p class="muted" style="margin-bottom:10px;">Linkeld a wallet-címed fent (a "Legjobb ajánlat" panelnél) a profit/nap szerinti rangsorhoz.</p>'
      : "";

    listEl.innerHTML = entries.length
      ? notice + entries.map(renderPaceEntry).join("")
      : '<p class="muted">Egyik aktív piacon sem találtam egyező sávot a kiválasztott tempó-sávokkal.</p>';
  } catch (e) {
    listEl.innerHTML = `<div class="error-box">Hiba: ${escapeHtml(e.message)}</div>`;
  }
}

async function refresh() {
  statusEl.textContent = "Frissítés...";
  try {
    const [events, alerted] = await Promise.all([
      searchElonTweetEvents(),
      fetchSentAlertComboKeys().catch(() => new Set()),
    ]);
    alertedComboKeys = alerted;

    const opportunities = events
      .map((e) => computeOpportunity(e, currentConfig))
      .filter(Boolean)
      .sort((a, b) => b.returnPct - a.returnPct);

    recList.innerHTML = opportunities.length
      ? opportunities.map(renderOpportunity).join("")
      : '<p class="muted">Jelenleg nincs a beállításoknak megfelelő javaslat. Próbáld lazítani a feltételeket (pl. hosszabb időablak vagy alacsonyabb elvárt megtérülés).</p>';

    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba: " + e.message;
  }
}

async function loadSharedConfigAndRender() {
  try {
    const row = await fetchSharedConfig();
    if (row) {
      currentConfig = rowToConfig(row);
      configSourceNote.textContent =
        "Megosztott beállítás, utoljára módosítva: " + new Date(row.updated_at).toLocaleString("hu-HU");
    }
  } catch (e) {
    configSourceNote.textContent = "Nem sikerült betölteni a megosztott beállítást, alapértékek használva.";
  }
  fillConfigForm(currentConfig);
  refresh();
  refreshBestPick();
}

document.getElementById("saveCfgBtn").addEventListener("click", async () => {
  cfgErrorBox.innerHTML = "";
  const pin = document.getElementById("cfgPin").value.trim();
  if (!pin) {
    cfgErrorBox.innerHTML = '<div class="error-box">Add meg a PIN-kódot a mentéshez.</div>';
    return;
  }
  const config = readConfigForm();
  try {
    const ok = await saveSharedConfig(pin, config);
    if (!ok) {
      cfgErrorBox.innerHTML = '<div class="error-box">Hibás PIN — a mentés nem történt meg.</div>';
      return;
    }
    document.getElementById("cfgPin").value = "";
    await loadSharedConfigAndRender();
  } catch (e) {
    cfgErrorBox.innerHTML = `<div class="error-box">Hiba mentés közben: ${escapeHtml(e.message)}</div>`;
  }
});

document.getElementById("refreshBtn").addEventListener("click", refresh);

document.getElementById("bestLoadBtn").addEventListener("click", () => {
  const addr = document.getElementById("bestAddressInput").value.trim();
  const errorBox = document.getElementById("bestErrorBox");
  if (!isValidPolygonAddress(addr)) {
    errorBox.innerHTML = '<div class="error-box">Érvénytelen cím — 0x-szal kezdődő, 42 karakteres Polygon címet adj meg.</div>';
    return;
  }
  localStorage.setItem(WALLET_STORAGE_KEY, addr);
  refreshBestPick();
});

const storedWalletAddress = getStoredWalletAddress();
if (storedWalletAddress) {
  document.getElementById("bestAddressInput").value = storedWalletAddress;
}

renderPaceSegmentChips();
refreshPaceScenarios();

loadSharedConfigAndRender();
setInterval(refresh, REFRESH_MS);
setInterval(refreshBestPick, BEST_PICK_REFRESH_MS);
setInterval(refreshPaceScenarios, BEST_PICK_REFRESH_MS);
