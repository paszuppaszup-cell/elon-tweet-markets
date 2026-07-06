const REFRESH_MS = 60000;
const CONFIG_KEY = "alert_recommendation_config";
const DEFAULT_CONFIG = {
  targetProfit: 20,
  maxHours: 48,
  minLegs: 2,
  maxLegs: 8,
  minReturnPct: 10,
};

const recList = document.getElementById("recList");
const statusEl = document.getElementById("statusText");

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
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

  return { event, hours, stakes, sumPrice: total, totalStake, shares, profit, returnPct };
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

async function refresh() {
  statusEl.textContent = "Frissítés...";
  try {
    const events = await searchElonTweetEvents();
    const config = loadConfig();
    const opportunities = events
      .map((e) => computeOpportunity(e, config))
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

document.getElementById("saveCfgBtn").addEventListener("click", () => {
  const config = readConfigForm();
  saveConfig(config);
  refresh();
});
document.getElementById("refreshBtn").addEventListener("click", refresh);

fillConfigForm(loadConfig());
refresh();
setInterval(refresh, REFRESH_MS);
