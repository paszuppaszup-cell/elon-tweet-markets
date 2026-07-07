const rowsEl = document.getElementById("priceRows");
const profitInput = document.getElementById("profit");
const errorBox = document.getElementById("errorBox");
const resultsEl = document.getElementById("results");
const paceInfoEl = document.getElementById("paceInfo");
const MIN_ROWS = 2;
const MAX_ROWS = 20;

let rowCounter = 0;
let eventContext = { liveCount: null, windowEnd: null };

function fmtUsd(n) {
  return "$" + n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renumberRows() {
  [...rowsEl.querySelectorAll(".price-field")].forEach((field, i) => {
    field.querySelector("label").textContent = `${i + 1}. sáv ára (cent)`;
  });
  const removeBtns = rowsEl.querySelectorAll(".remove-row-btn");
  removeBtns.forEach((btn) => {
    btn.disabled = removeBtns.length <= MIN_ROWS;
  });
}

function addRow(value, label) {
  if (rowsEl.querySelectorAll(".price-field").length >= MAX_ROWS) return;
  rowCounter += 1;
  const field = document.createElement("div");
  field.className = "field price-field";
  field.innerHTML = `
    <label>sáv ára (cent)</label>
    <div class="row-inline">
      <input type="number" class="price-input" min="0" max="99.99" step="0.1" placeholder="pl. 15"
        value="${value ?? ""}" data-label="${label || ""}">
      <button type="button" class="remove-row-btn" title="Sáv eltávolítása">×</button>
    </div>
  `;
  field.querySelector(".remove-row-btn").addEventListener("click", () => {
    if (rowsEl.querySelectorAll(".price-field").length <= MIN_ROWS) return;
    field.remove();
    renumberRows();
  });
  rowsEl.appendChild(field);
  renumberRows();
}

function renderPaceInfo(priceInputs) {
  paceInfoEl.innerHTML = "";

  if (eventContext.liveCount === null || !eventContext.windowEnd) return;

  const daysRemaining = (new Date(eventContext.windowEnd).getTime() - Date.now()) / 86400000;
  const rowsWithLabels = priceInputs
    .map((el) => ({ label: el.dataset.label, range: parseBucketRange(el.dataset.label) }))
    .filter((r) => r.range);

  if (!rowsWithLabels.length) return;

  if (daysRemaining <= 0) {
    paceInfoEl.innerHTML = '<p class="muted" style="margin-top:14px;">Ez az időszak már lezárult, nincs hátralévő nap.</p>';
    return;
  }

  const current = eventContext.liveCount;
  const rows = rowsWithLabels
    .map(({ label, range }) => {
      if (current > range.max) {
        return `<tr><td>${label}</td><td colspan="2" class="muted">már meghaladta ezt a sávot (jelenlegi: ${current})</td></tr>`;
      }
      const neededMin = Math.max(0, range.min - current);
      const perDayMin = neededMin / daysRemaining;
      if (range.max === Infinity) {
        return `<tr><td>${label}</td><td colspan="2">legalább <b>${perDayMin.toFixed(1)}</b> tweet/nap kell (még ${neededMin} tweet, ${daysRemaining.toFixed(1)} nap alatt)</td></tr>`;
      }
      const neededMax = Math.max(0, range.max - current);
      const perDayMax = neededMax / daysRemaining;
      return `
        <tr>
          <td>${label}</td>
          <td>${perDayMin.toFixed(1)}–${perDayMax.toFixed(1)} tweet/nap</td>
          <td class="muted">még ${neededMin}–${neededMax} tweet, ${daysRemaining.toFixed(1)} nap alatt</td>
        </tr>`;
    })
    .join("");

  paceInfoEl.innerHTML = `
    <div class="panel" style="margin-top:16px;">
      <h3 style="margin-top:0;">Szükséges napi tweet-tempó</h3>
      <p class="muted" style="font-size:13px;">
        Jelenlegi tweet-szám ebben az időszakban: <b>${current}</b> ·
        Hátralévő idő: <b>${daysRemaining.toFixed(1)} nap</b>
      </p>
      <table>
        <thead><tr><th>Sáv</th><th>Szükséges napi átlag</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function calculate() {
  errorBox.innerHTML = "";
  resultsEl.innerHTML = "";
  paceInfoEl.innerHTML = "";

  const priceInputs = [...rowsEl.querySelectorAll(".price-input")];
  const cents = priceInputs.map((el) => parseFloat(el.value));
  const profit = parseFloat(profitInput.value);

  if (cents.length < MIN_ROWS) {
    errorBox.innerHTML = `<div class="error-box">Legalább ${MIN_ROWS} sávot adj meg.</div>`;
    return;
  }
  if (cents.some((c) => isNaN(c) || c <= 0 || c >= 100)) {
    errorBox.innerHTML = '<div class="error-box">Minden sáv árát add meg, 0 és 100 cent között.</div>';
    return;
  }
  if (isNaN(profit) || profit <= 0) {
    errorBox.innerHTML = '<div class="error-box">Add meg a kívánt nyereséget (nagyobb, mint 0).</div>';
    return;
  }

  const prices = cents.map((c) => c / 100);
  const sumProb = prices.reduce((a, b) => a + b, 0);

  if (sumProb >= 1) {
    errorBox.innerHTML = `<div class="error-box">A megadott sávok árának összege ${(sumProb * 100).toFixed(1)} cent,
      vagyis eléri/meghaladja a 100 centet — ezekkel a sávokkal nincs garantált nyereség,
      bármekkora összeget is teszel be (a matek szerint mindig mínuszban maradnál, ha
      csak ezeket a sávokat tartod). Válassz kevesebb vagy olcsóbb/kevésbé valószínű sávokat.</div>`;
    return;
  }

  const shares = profit / (1 - sumProb);
  const stakes = prices.map((p) => shares * p);
  const totalStake = stakes.reduce((a, b) => a + b, 0);

  resultsEl.innerHTML = `
    <div class="result-grid">
      ${stakes
        .map(
          (s, i) => `
        <div class="result-card">
          <div class="label">${i + 1}. sáv (${cents[i]}c) — ennyit tegyél be</div>
          <div class="value">${fmtUsd(s)}</div>
        </div>`
        )
        .join("")}
      <div class="result-card">
        <div class="label">Összes befektetés (tét)</div>
        <div class="value">${fmtUsd(totalStake)}</div>
      </div>
      <div class="result-card">
        <div class="label">Teljes kifizetés a nyertes lábon (tét + profit)</div>
        <div class="value">${fmtUsd(shares)}</div>
      </div>
      <div class="result-card">
        <div class="label">Ebből tiszta nyereség a befektetett pénzen felül</div>
        <div class="value" style="color:var(--green);">${fmtUsd(profit)}</div>
      </div>
      <div class="result-card">
        <div class="label">Max veszteség, ha egy nem választott sáv jön be</div>
        <div class="value" style="color:var(--red);">${fmtUsd(totalStake)}</div>
      </div>
    </div>
    <p class="muted" style="font-size:13px;margin-top:14px;">
      ${fmtUsd(totalStake)} tét + ${fmtUsd(profit)} profit = ${fmtUsd(shares)} kifizetés arra a sávra,
      amelyik bejön — ugyanennyi ${fmtUsd(shares)} jön vissza bármelyik nyertes lábon, csak a hozzá tartozó
      tét (és így az abból számolt tiszta nyereség) más-más összegű volt sávanként.
    </p>
  `;

  renderPaceInfo(priceInputs);
}

function prefillFromMarket() {
  const raw = localStorage.getItem("calc_prefill");
  if (!raw) return false;
  localStorage.removeItem("calc_prefill");
  try {
    const data = JSON.parse(raw);

    // ujabb alak: {buckets:[{price,label}], liveCount, windowEnd}
    if (data && Array.isArray(data.buckets) && data.buckets.length) {
      rowsEl.innerHTML = "";
      data.buckets.forEach((b) => addRow(b.price, b.label));
      eventContext = { liveCount: data.liveCount ?? null, windowEnd: data.windowEnd ?? null };
      return true;
    }

    // regi alak: sima ar-tomb (visszafele kompatibilitas)
    if (Array.isArray(data) && data.length) {
      rowsEl.innerHTML = "";
      data.forEach((v) => addRow(v));
      return true;
    }
  } catch (e) {
    /* ignore malformed prefill data */
  }
  return false;
}

document.getElementById("addRowBtn").addEventListener("click", () => addRow());
document.getElementById("calcBtn").addEventListener("click", calculate);

if (!prefillFromMarket()) {
  addRow();
  addRow();
}
