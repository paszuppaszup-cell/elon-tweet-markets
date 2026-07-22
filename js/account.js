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

// ---------------------------------------------------------------------------
// Kovetett kereskedok: lista + Telegram kapcsolo + friss tradejeik.
// A lista Supabase-ben van (a bot is ezt olvassa), ezert az iras PIN-vedett.
// ---------------------------------------------------------------------------

const followErrorBox = document.getElementById("followErrorBox");
const followListEl = document.getElementById("followList");
const followPinEl = document.getElementById("followPin");

const TRADES_PER_TRADER = 5;

function shortAddr(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function followError(msg) {
  followErrorBox.innerHTML = `<div class="error-box">${escapeHtml(msg)}</div>`;
}

function requirePin() {
  const pin = followPinEl.value.trim();
  if (!pin) {
    followError("Add meg a PIN-kódot a módosításhoz.");
    return null;
  }
  return pin;
}

// A muvelet utan ne maradjon a PIN a mezoben.
async function afterWrite(ok) {
  if (!ok) {
    followError("Hibás PIN (vagy 5 hibás próbálkozás után 15 perc zárolás), a mentés nem történt meg.");
    return false;
  }
  followPinEl.value = "";
  followErrorBox.innerHTML = "";
  await loadFollowedTraders();
  return true;
}

function renderTraderCard(t, trades) {
  const name = t.label || (trades[0] && trades[0].pseudonym) || shortAddr(t.address);
  const rows = trades.length
    ? trades
        .map(
          (tr) => `
        <tr>
          <td class="muted">${new Date(tr.timestamp * 1000).toLocaleString("hu-HU")}</td>
          <td style="color:${tr.side === "BUY" ? "var(--green)" : "var(--red)"};">
            ${tr.side === "BUY" ? "Nyitás" : "Zárás"}
          </td>
          <td>${escapeHtml(tr.title || "?")}</td>
          <td>${escapeHtml(tr.outcome || "?")}</td>
          <td>${(Number(tr.price) * 100).toFixed(1)}c</td>
          <td>${fmtUsd(Number(tr.size) * Number(tr.price))}</td>
        </tr>`
        )
        .join("")
    : '<tr><td colspan="6" class="muted">Nincs friss trade.</td></tr>';

  return `
    <div class="panel" style="background:#0f1420;margin-bottom:12px;">
      <div class="card-head">
        <h3 style="font-size:15px;">${escapeHtml(name)}
          <span class="muted" style="font-weight:400;font-size:12px;">${shortAddr(t.address)}</span>
        </h3>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <label class="chip chip-toggle ${t.notify ? "checked" : ""}" data-notify-addr="${escapeHtml(t.address)}">
            <input type="checkbox" ${t.notify ? "checked" : ""}> Telegram
          </label>
          <button data-remove-addr="${escapeHtml(t.address)}" style="color:var(--red);">Törlés</button>
        </div>
      </div>
      <div class="table-scroll" style="margin-top:10px;">
        <table>
          <thead><tr><th>Idő</th><th>Irány</th><th>Piac</th><th>Kimenet</th><th>Ár</th><th>Érték</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function loadFollowedTraders() {
  try {
    const traders = await fetchFollowedTraders();
    if (!traders.length) {
      followListEl.innerHTML =
        '<p class="muted">Még nincs követett kereskedő. Add hozzá egy publikus wallet-címét fent.</p>';
      return;
    }

    // Minden kovetett cimhez lekerjuk a friss tradeket (parhuzamosan). Ha egy
    // cim lekerese elhasal, az a kartya ures marad, a tobbi megjelenik.
    const tradesList = await Promise.all(
      traders.map((t) =>
        fetchUserTrades(t.address, TRADES_PER_TRADER).catch(() => [])
      )
    );

    followListEl.innerHTML = traders
      .map((t, i) => renderTraderCard(t, tradesList[i] || []))
      .join("");

    followListEl.querySelectorAll("[data-notify-addr]").forEach((chip) => {
      chip.querySelector("input").addEventListener("change", async (e) => {
        const pin = requirePin();
        if (!pin) {
          e.target.checked = !e.target.checked; // vissza, amig nincs PIN
          return;
        }
        const addr = chip.dataset.notifyAddr;
        try {
          const ok = await manageFollowedTrader(pin, "update", addr, null, e.target.checked);
          if (!(await afterWrite(ok))) e.target.checked = !e.target.checked;
        } catch (err) {
          followError("Hiba mentés közben: " + err.message);
          e.target.checked = !e.target.checked;
        }
      });
    });

    followListEl.querySelectorAll("[data-remove-addr]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pin = requirePin();
        if (!pin) return;
        const addr = btn.dataset.removeAddr;
        if (!confirm("Biztosan törlöd ezt a követett kereskedőt?")) return;
        try {
          await afterWrite(await manageFollowedTrader(pin, "remove", addr, null, null));
        } catch (err) {
          followError("Hiba törlés közben: " + err.message);
        }
      });
    });
  } catch (e) {
    followListEl.innerHTML = `<div class="error-box">Nem sikerült betölteni a listát: ${escapeHtml(e.message)}</div>`;
  }
}

document.getElementById("followAddBtn").addEventListener("click", async () => {
  followErrorBox.innerHTML = "";
  const addr = document.getElementById("followAddr").value.trim();
  const label = document.getElementById("followLabel").value.trim();
  if (!isValidPolygonAddress(addr)) {
    followError("Érvénytelen cím — 0x-szal kezdődő, 42 karakteres Polygon címet adj meg.");
    return;
  }
  const pin = requirePin();
  if (!pin) return;
  try {
    const ok = await manageFollowedTrader(pin, "add", addr, label, true);
    if (await afterWrite(ok)) {
      document.getElementById("followAddr").value = "";
      document.getElementById("followLabel").value = "";
    }
  } catch (e) {
    followError("Hiba hozzáadás közben: " + e.message);
  }
});

loadFollowedTraders();
