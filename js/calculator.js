const inputs = {
  p1: document.getElementById("p1"),
  p2: document.getElementById("p2"),
  p3: document.getElementById("p3"),
  p4: document.getElementById("p4"),
  profit: document.getElementById("profit"),
};
const errorBox = document.getElementById("errorBox");
const resultsEl = document.getElementById("results");

function fmtUsd(n) {
  return "$" + n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calculate() {
  errorBox.innerHTML = "";
  resultsEl.innerHTML = "";

  const cents = [inputs.p1, inputs.p2, inputs.p3, inputs.p4].map((el) => parseFloat(el.value));
  const profit = parseFloat(inputs.profit.value);

  if (cents.some((c) => isNaN(c) || c <= 0 || c >= 100)) {
    errorBox.innerHTML = '<div class="error-box">Mind a 4 sáv árát add meg, 0 és 100 cent között.</div>';
    return;
  }
  if (isNaN(profit) || profit <= 0) {
    errorBox.innerHTML = '<div class="error-box">Add meg a kívánt nyereséget (nagyobb, mint 0).</div>';
    return;
  }

  const prices = cents.map((c) => c / 100);
  const sumProb = prices.reduce((a, b) => a + b, 0);

  if (sumProb >= 1) {
    errorBox.innerHTML = `<div class="error-box">A 4 sáv árának összege ${(sumProb * 100).toFixed(1)} cent,
      vagyis eléri/meghaladja a 100 centet — ezzel a 4 sávval nincs garantált nyereség,
      bármekkora összeget is teszel be (a matek szerint mindig mínuszban maradnál, ha
      csak ezt a 4 sávot tartod). Válassz olcsóbb/kevésbé valószínű sávokat.</div>`;
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
        <div class="label">Összes befektetés</div>
        <div class="value">${fmtUsd(totalStake)}</div>
      </div>
      <div class="result-card">
        <div class="label">Garantált nyereség, ha a 4 közül bármelyik bejön</div>
        <div class="value" style="color:var(--green);">${fmtUsd(profit)}</div>
      </div>
      <div class="result-card">
        <div class="label">Max veszteség, ha egy 5. (nem választott) sáv jön be</div>
        <div class="value" style="color:var(--red);">${fmtUsd(totalStake)}</div>
      </div>
    </div>
  `;
}

function prefillFromMarket() {
  const raw = localStorage.getItem("calc_prefill");
  if (!raw) return;
  localStorage.removeItem("calc_prefill");
  try {
    const values = JSON.parse(raw);
    [inputs.p1, inputs.p2, inputs.p3, inputs.p4].forEach((el, i) => {
      if (values[i] !== undefined) el.value = values[i];
    });
  } catch (e) {
    /* ignore malformed prefill data */
  }
}

document.getElementById("calcBtn").addEventListener("click", calculate);
prefillFromMarket();
