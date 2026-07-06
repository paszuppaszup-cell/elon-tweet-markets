const REFRESH_MS = 60000;
const contentEl = document.getElementById("content");
const params = new URLSearchParams(window.location.search);
const eventId = params.get("id");

let chartInstance = null;
const selectedBuckets = new Set();
const MAX_CALC_BUCKETS = 20;

function fmtPct(p) {
  return (p * 100).toFixed(1) + "%";
}

function bucketLabel(b) {
  return b.groupItemTitle || b.outcomes[0] || b.question;
}

function parseBucketRange(label) {
  const clean = (label || "").trim();
  if (clean.endsWith("+")) {
    return { min: parseInt(clean, 10), max: Infinity };
  }
  if (clean.startsWith("<")) {
    return { min: 0, max: parseInt(clean.slice(1), 10) - 1 };
  }
  const parts = clean.split("-").map((n) => parseInt(n, 10));
  if (parts.length === 2 && !parts.some(isNaN)) {
    return { min: parts[0], max: parts[1] };
  }
  return null;
}

function findMatchingBucketToken(buckets, liveCount) {
  for (const b of buckets) {
    const range = parseBucketRange(bucketLabel(b));
    if (range && liveCount >= range.min && liveCount <= range.max) {
      return b.tokenIds[0];
    }
  }
  return null;
}

function renderSkeleton(event) {
  const weekly = isWeeklyRangeEvent(event);
  contentEl.innerHTML = `
    <div class="panel">
      <div class="card-head">
        <h3 style="font-size:20px;">${event.title}</h3>
        <span class="badge ${weekly ? "" : "monthly"}">${weekly ? "heti" : "havi"}</span>
      </div>
      <p class="muted">
        Indul: ${new Date(event.startDate).toLocaleString("hu-HU")} ·
        Zárás: ${new Date(event.endDate).toLocaleString("hu-HU")} ·
        Volumen: $${Number(event.volume || 0).toLocaleString("hu-HU", { maximumFractionDigits: 0 })}
      </p>
      <div class="status-bar">
        <span id="statusText">Betöltés...</span>
        <button id="refreshBtn">Frissítés</button>
      </div>
    </div>

    <div class="panel">
      <div class="card-head">
        <h3>Élő tweet-szám ebben az időszakban</h3>
        <span class="muted" style="font-size:12px;">forrás: xtracker.polymarket.com (a piac hivatalos elszámolási forrása)</span>
      </div>
      <div id="liveCountBox" class="loading">Betöltés...</div>
    </div>

    <div class="panel">
      <canvas id="priceChart" height="90"></canvas>
    </div>

    <div class="panel">
      <div class="card-head">
        <h3>Sávok (élő valószínűség)</h3>
        <button id="sendToCalcBtn">Kiválasztottak → kalkulátor</button>
      </div>
      <table>
        <thead>
          <tr><th></th><th>Sáv</th><th>Ár / valószínűség</th><th></th><th>Volumen</th></tr>
        </thead>
        <tbody id="bucketRows"></tbody>
      </table>
    </div>
  `;
  document.getElementById("refreshBtn").addEventListener("click", () => loadAndRender(true));
  document.getElementById("sendToCalcBtn").addEventListener("click", sendSelectedToCalculator);
}

function renderBuckets(buckets) {
  const rows = document.getElementById("bucketRows");
  const sorted = [...buckets].sort((a, b) => b.prices[0] - a.prices[0]);
  rows.innerHTML = sorted
    .map((b, i) => {
      const price = b.prices[0] || 0;
      const checked = selectedBuckets.has(b.tokenIds[0]) ? "checked" : "";
      return `
        <tr class="${i < 3 ? "top-row" : ""}" data-row-token="${b.tokenIds[0]}">
          <td><input type="checkbox" data-token="${b.tokenIds[0]}" data-price="${(price * 100).toFixed(2)}" class="bucket-check" ${checked}></td>
          <td>${bucketLabel(b)}</td>
          <td>${fmtPct(price)} (${(price * 100).toFixed(1)}c)</td>
          <td style="width:120px;"><div class="bar-track"><div class="bar-fill" style="width:${Math.min(price * 100, 100)}%"></div></div></td>
          <td class="muted">$${b.volume.toLocaleString("hu-HU", { maximumFractionDigits: 0 })}</td>
        </tr>
      `;
    })
    .join("");

  rows.querySelectorAll(".bucket-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const token = e.target.dataset.token;
      const price = e.target.dataset.price;
      if (e.target.checked) {
        if (selectedBuckets.size >= MAX_CALC_BUCKETS) {
          e.target.checked = false;
          alert(`Legfeljebb ${MAX_CALC_BUCKETS} sávot választhatsz ki a kalkulátorhoz.`);
          return;
        }
        selectedBuckets.add(token);
        e.target.dataset.priceValue = price;
      } else {
        selectedBuckets.delete(token);
      }
    });
  });

  return sorted;
}

function sendSelectedToCalculator() {
  const checks = [...document.querySelectorAll(".bucket-check:checked")];
  if (checks.length < 2) {
    alert("Jelölj be legalább 2 sávot (a kalkulátor legalább 2 sávval tud számolni).");
    return;
  }
  const prices = checks.map((c) => c.dataset.price);
  localStorage.setItem("calc_prefill", JSON.stringify(prices));
  window.location.href = "calculator.html";
}

async function updateLiveCount(event, buckets) {
  const box = document.getElementById("liveCountBox");
  if (!box) return;
  try {
    const trackings = await fetchElonTrackings();
    const window_ = findTrackingWindow(trackings, event.title);
    if (!window_) {
      box.innerHTML = '<p class="muted">Ehhez a piachoz nincs egyező élő számláló az xtracker-en (cím nem egyezik).</p>';
      return;
    }

    const posts = await fetchElonPosts();
    const count = countPostsInWindow(posts, window_.startDate, window_.endDate);
    const matchToken = findMatchingBucketToken(buckets, count);

    document.querySelectorAll("#bucketRows tr").forEach((tr) => {
      tr.classList.toggle("live-match", tr.dataset.rowToken === matchToken);
    });

    const matchLabel = matchToken
      ? bucketLabel(buckets.find((b) => b.tokenIds[0] === matchToken))
      : "nincs egyező sáv";

    box.innerHTML = `
      <div class="result-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
        <div class="result-card">
          <div class="label">Eddigi tweet-szám ebben az időszakban</div>
          <div class="value">${count}</div>
        </div>
        <div class="result-card">
          <div class="label">Jelenleg ebbe a sávba esne</div>
          <div class="value" style="color:var(--green);">${matchLabel}</div>
        </div>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px;">
        Számlálási ablak: ${new Date(window_.startDate).toLocaleString("hu-HU")} –
        ${new Date(window_.endDate).toLocaleString("hu-HU")}
      </p>
    `;
  } catch (e) {
    box.innerHTML = `<p class="muted">Élő tweet-szám jelenleg nem elérhető (${e.message}).</p>`;
  }
}

async function renderChart(topBuckets) {
  const ctx = document.getElementById("priceChart");
  const datasets = [];
  const colors = ["#4f8cff", "#2ecc71", "#f5b942"];

  for (let i = 0; i < Math.min(3, topBuckets.length); i++) {
    const b = topBuckets[i];
    try {
      const history = await fetchPriceHistory(b.tokenIds[0], "1w", 60);
      datasets.push({
        label: bucketLabel(b),
        data: history.map((h) => ({ x: h.t * 1000, y: h.p * 100 })),
        borderColor: colors[i],
        backgroundColor: colors[i],
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.15,
      });
    } catch (e) {
      /* ha egy sav historyja nem elerheto, csak kihagyjuk */
    }
  }

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      scales: {
        x: { type: "time", time: { unit: "hour" }, ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7", callback: (v) => v + "%" }, grid: { color: "#232b3d" } },
      },
      plugins: { legend: { labels: { color: "#e6e9f0" } } },
    },
  });
}

async function loadAndRender(isManualRefresh) {
  const statusEl = document.getElementById("statusText");
  if (statusEl) statusEl.textContent = "Frissítés...";
  try {
    const event = await fetchEventById(eventId);
    const buckets = (event.markets || [])
      .filter((m) => m.active && !m.closed)
      .map(normalizeMarket)
      .filter((m) => m.prices.length && m.tokenIds.length);

    const sorted = renderBuckets(buckets);
    await updateLiveCount(event, buckets);
    if (isManualRefresh === undefined) {
      await renderChart(sorted.slice(0, 3));
    }
    document.getElementById("statusText").textContent =
      "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    if (statusEl) statusEl.textContent = "Hiba: " + e.message;
  }
}

async function init() {
  if (!eventId) {
    contentEl.innerHTML = '<p class="muted">Hiányzó piac azonosító.</p>';
    return;
  }
  try {
    const event = await fetchEventById(eventId);
    renderSkeleton(event);
    const buckets = (event.markets || [])
      .filter((m) => m.active && !m.closed)
      .map(normalizeMarket)
      .filter((m) => m.prices.length && m.tokenIds.length);
    const sorted = renderBuckets(buckets);
    await updateLiveCount(event, buckets);
    await renderChart(sorted.slice(0, 3));
    document.getElementById("statusText").textContent =
      "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
    setInterval(() => loadAndRender(true), REFRESH_MS);
  } catch (e) {
    contentEl.innerHTML = `<p class="muted">Hiba az adatok betöltésekor: ${e.message}</p>`;
  }
}

init();
