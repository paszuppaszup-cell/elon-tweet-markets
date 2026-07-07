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
        <td>${s.label}</td>
        <td>${(s.price * 100).toFixed(1)}c</td>
        <td>${fmtUsd(s.stake)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="card" style="cursor:default;">
      <div class="card-head">
        <h3><a href="market.html?id=${opp.event.id}" style="color:inherit;">${opp.event.title}</a></h3>
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
        <td>${b.label}</td>
        <td>${(b.price * 100).toFixed(1)}c</td>
        <td>${fmtUsd(shares * b.price)}</td>
      </tr>`
    )
    .join("");

  box.innerHTML = `
    <div class="card-head">
      <h3><a href="market.html?id=${best.event.id}" style="color:inherit;">${best.event.title}</a></h3>
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
    errorBox.innerHTML = `<div class="error-box">Hiba: ${e.message}</div>`;
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

async function computeEventLiveState(event, posts, trackings) {
  let window_ = findTrackingWindow(trackings, event.title);
  if (!window_) window_ = parseMonthlyWindowFromTitle(event.title);
  if (!window_) return null;

  const count = countPostsInWindow(posts, window_.startDate, window_.endDate);
  const daysRemaining = (new Date(window_.endDate).getTime() - Date.now()) / 86400000;
  return { count, daysRemaining };
}

function renderPaceScenarioCard(event, liveState, buckets, segments) {
  if (liveState.daysRemaining <= 0) {
    return `
      <div class="card" style="cursor:default;">
        <div class="card-head"><h3><a href="market.html?id=${event.id}" style="color:inherit;">${event.title}</a></h3></div>
        <p class="muted">Ez az időszak már lezárult.</p>
      </div>`;
  }

  const rangedBuckets = buckets
    .map((b) => ({ ...b, range: parseBucketRange(b.label) }))
    .filter((b) => b.range);

  const rows = segments
    .map((seg) => {
      const projLo = liveState.count + seg.lo * liveState.daysRemaining;
      const projHi = liveState.count + seg.hi * liveState.daysRemaining;
      const matches = rangedBuckets
        .filter((b) => b.range.max >= projLo && b.range.min <= projHi)
        .sort((a, b) => a.range.min - b.range.min);

      const matchText = matches.length
        ? matches.map((b) => `${b.label} (${(b.price * 100).toFixed(1)}c)`).join(", ")
        : "nincs egyező sáv";

      return `
        <tr>
          <td>${seg.label} tweet/nap</td>
          <td class="muted">${Math.round(projLo)}–${Math.round(projHi)} tweet összesen</td>
          <td>${matchText}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="card" style="cursor:default;">
      <div class="card-head">
        <h3><a href="market.html?id=${event.id}" style="color:inherit;">${event.title}</a></h3>
        <span class="badge">${liveState.daysRemaining.toFixed(1)} nap van hátra</span>
      </div>
      <p class="muted" style="font-size:13px;">Eddigi tweet-szám ebben az időszakban: <b>${liveState.count}</b></p>
      <table style="margin-top:10px;">
        <thead><tr><th>Napi tempó</th><th>Várható össz. tweet</th><th>Ez alapján a sáv(ok)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
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

  listEl.innerHTML = '<p class="loading">Betöltés...</p>';
  try {
    const [events, posts, trackings] = await Promise.all([
      searchElonTweetEvents(),
      fetchElonPosts(),
      fetchElonTrackings(),
    ]);

    const cards = [];
    for (const event of events) {
      const liveState = await computeEventLiveState(event, posts, trackings);
      if (!liveState) continue;
      const buckets = loadBucketsFromEvent(event);
      cards.push(renderPaceScenarioCard(event, liveState, buckets, segments));
    }

    listEl.innerHTML = cards.length
      ? cards.join("")
      : '<p class="muted">Egyik aktív piachoz sem található élő tweet-számláló.</p>';
  } catch (e) {
    listEl.innerHTML = `<div class="error-box">Hiba: ${e.message}</div>`;
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
    cfgErrorBox.innerHTML = `<div class="error-box">Hiba mentés közben: ${e.message}</div>`;
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
