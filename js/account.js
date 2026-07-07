const REFRESH_MS = 60000;
const addressInput = document.getElementById("addressInput");
const loadBtn = document.getElementById("loadBtn");
const errorBox = document.getElementById("errorBox");
const accountContent = document.getElementById("accountContent");
const STORAGE_KEY = "polymarket_wallet_address";

let refreshTimer = null;

function fmtUsd(n) {
  return "$" + Number(n).toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pnlColor(n) {
  return n >= 0 ? "var(--green)" : "var(--red)";
}

function renderEvaluationCell(evaluation) {
  if (!evaluation) {
    return '<span class="muted" style="font-size:12px;">n/a</span>';
  }
  const modelPct = (evaluation.modelP * 100).toFixed(1);
  const priceCents = (evaluation.curPrice * 100).toFixed(1);
  const detail = `modell: ${modelPct}% · ár: ${priceCents}c`;
  if (evaluation.signal) {
    return `
      <div style="color:var(--red);font-weight:600;">Statisztikailag zárd le</div>
      <div class="muted" style="font-size:11px;">${detail} · becsült megspórolt: ${fmtUsd(evaluation.edgeUsd)}</div>`;
  }
  return `
    <div style="color:var(--green);">Tarts</div>
    <div class="muted" style="font-size:11px;">${detail}</div>`;
}

function renderSkeleton() {
  accountContent.innerHTML = `
    <div class="panel">
      <div class="status-bar">
        <span id="statusText">Betöltés...</span>
        <button id="refreshBtn">Frissítés</button>
        <button id="changeAddrBtn">Másik cím</button>
      </div>
      <div class="result-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
        <div class="result-card">
          <div class="label">Portfólió érték</div>
          <div class="value" id="portfolioValue">–</div>
        </div>
        <div class="result-card">
          <div class="label">Nyitott pozíciók száma</div>
          <div class="value" id="positionsCount">–</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Nyitott pozíciók</h3>
      <p class="muted" style="font-size:12px;">
        Az "Értékelés" oszlop az Elon Musk tweet-szám pozíciókhoz egy Poisson-modellel
        (az eddigi tweet-tempó alapján) megbecsüli a tartott sáv valós nyerési esélyét,
        és összeveti a jelenlegi piaci árral — ha statisztikailag jobban jársz most
        eladással, mint tartással, "Zárd le" jelzést kapsz. Csak matematikai becslés, nem garancia.
      </p>
      <table>
        <thead>
          <tr><th>Piac</th><th>Kimenet</th><th>Méret</th><th>Átl. ár</th><th>Jelenlegi érték</th><th>PnL</th><th>Értékelés</th></tr>
        </thead>
        <tbody id="positionsRows"></tbody>
      </table>
    </div>

    <div class="panel">
      <h3>Legutóbbi tradek</h3>
      <table>
        <thead>
          <tr><th>Idő</th><th>Irány</th><th>Piac</th><th>Kimenet</th><th>Méret</th><th>Ár</th></tr>
        </thead>
        <tbody id="tradesRows"></tbody>
      </table>
    </div>
  `;
  document.getElementById("refreshBtn").addEventListener("click", () => loadAccount(getStoredAddress()));
  document.getElementById("changeAddrBtn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    addressInput.value = "";
    accountContent.innerHTML = "";
    if (refreshTimer) clearInterval(refreshTimer);
  });
}

function getStoredAddress() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

async function loadAccount(address) {
  errorBox.innerHTML = "";
  if (!isValidPolygonAddress(address)) {
    errorBox.innerHTML = '<div class="error-box">Érvénytelen cím — 0x-szal kezdődő, 42 karakteres Polygon címet adj meg.</div>';
    return;
  }

  localStorage.setItem(STORAGE_KEY, address);
  addressInput.value = address;

  if (!document.getElementById("statusText")) {
    renderSkeleton();
  }
  const statusEl = document.getElementById("statusText");
  statusEl.textContent = "Frissítés...";

  try {
    const [value, allPositions, trades] = await Promise.all([
      fetchPortfolioValue(address),
      fetchPositions(address),
      fetchUserTrades(address, 30),
    ]);

    // A /positions vegpont MINDEN valaha volt poziciot visszaad, a mar
    // lezart (feloldott) piacokat is - a "redeemable: true" jeloli, hogy a
    // piac mar lezarult es a token feloldhato/feloldva. A Polymarket sajat
    // feluleten "nyitott poziciokent" csak a redeemable:false-ak szamitanak.
    const positions = allPositions.filter((p) => p.redeemable === false);

    document.getElementById("portfolioValue").textContent = fmtUsd(value);
    document.getElementById("positionsCount").textContent = positions.length;

    let evaluations = new Map();
    try {
      evaluations = await evaluateOpenPositions(positions);
    } catch (e) {
      /* modell-ertekeles nem elerheto - a poziciok listaja attol meg megjelenik */
    }

    document.getElementById("positionsRows").innerHTML = positions.length
      ? positions
          .map(
            (p) => `
        <tr>
          <td>${escapeHtml(p.title)}</td>
          <td>${escapeHtml(p.outcome)}</td>
          <td>${Number(p.size).toLocaleString("hu-HU", { maximumFractionDigits: 2 })}</td>
          <td>${(p.avgPrice * 100).toFixed(1)}c</td>
          <td>${fmtUsd(p.currentValue)}</td>
          <td style="color:${pnlColor(p.cashPnl)};">${fmtUsd(p.cashPnl)} (${p.percentPnl.toFixed(1)}%)</td>
          <td>${renderEvaluationCell(evaluations.get(p.asset))}</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="muted">Nincs nyitott pozíció ezen a címen.</td></tr>';

    document.getElementById("tradesRows").innerHTML = trades.length
      ? trades
          .map(
            (t) => `
        <tr>
          <td class="muted">${new Date(t.timestamp * 1000).toLocaleString("hu-HU")}</td>
          <td style="color:${t.side === "BUY" ? "var(--green)" : "var(--red)"};">${escapeHtml(t.side)}</td>
          <td>${escapeHtml(t.title)}</td>
          <td>${escapeHtml(t.outcome)}</td>
          <td>${Number(t.size).toLocaleString("hu-HU", { maximumFractionDigits: 2 })}</td>
          <td>${(t.price * 100).toFixed(1)}c</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="muted">Nincs trade-előzmény ezen a címen.</td></tr>';

    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba: " + e.message;
  }

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadAccount(address), REFRESH_MS);
}

loadBtn.addEventListener("click", () => loadAccount(addressInput.value));
addressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadAccount(addressInput.value);
});

const stored = getStoredAddress();
if (stored) {
  loadAccount(stored);
}
