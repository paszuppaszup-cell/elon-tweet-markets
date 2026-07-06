const rowsEl = document.getElementById("priceRows");
const profitInput = document.getElementById("profit");
const errorBox = document.getElementById("errorBox");
const resultsEl = document.getElementById("results");
const MIN_ROWS = 2;
const MAX_ROWS = 20;

let rowCounter = 0;

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

function addRow(value) {
  if (rowsEl.querySelectorAll(".price-field").length >= MAX_ROWS) return;
  rowCounter += 1;
  const id = `row-${rowCounter}`;
  const field = document.createElement("div");
  field.className = "field price-field";
  field.innerHTML = `
    <label>sáv ára (cent)</label>
    <div class="row-inline">
      <input type="number" class="price-input" min="0" max="99.99" step="0.1" placeholder="pl. 15" value="${value ?? ""}">
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

function calculate() {
  errorBox.innerHTML = "";
  resultsEl.innerHTML = "";

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
}

function prefillFromMarket() {
  const raw = localStorage.getItem("calc_prefill");
  if (!raw) return;
  localStorage.removeItem("calc_prefill");
  try {
    const values = JSON.parse(raw);
    if (Array.isArray(values) && values.length) {
      rowsEl.innerHTML = "";
      values.forEach((v) => addRow(v));
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
