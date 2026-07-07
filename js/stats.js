const WEEKDAY_NAMES_HU = ["Vas", "Hét", "Kedd", "Szer", "Csüt", "Pén", "Szo"];
const statusEl = document.getElementById("statusText");

let dailyChartInstance = null;
let weekdayChartInstance = null;
let hourChartInstance = null;

function fmtNum(n, digits = 1) {
  return Number(n).toLocaleString("hu-HU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function renderSummary(entries, series) {
  const grid = document.getElementById("summaryGrid");
  if (!entries.length) {
    grid.innerHTML = '<p class="muted">Még nincs naplózott adat.</p>';
    return;
  }

  const firstDay = series[0].date;
  const lastDay = series[series.length - 1].date;
  const totalDays = series.length;
  const avgPerDay = entries.length / totalDays;

  const busiest = series.reduce((a, b) => (b.count > a.count ? b : a), series[0]);
  const last7 = series.slice(-7);
  const last7Avg = last7.reduce((a, p) => a + p.count, 0) / last7.length;

  const cards = [
    { label: "Naplózott tweetek", value: entries.length.toLocaleString("hu-HU") },
    { label: "Időszak", value: `${firstDay} – ${lastDay}` },
    { label: "Napok száma", value: totalDays.toLocaleString("hu-HU") },
    { label: "Átlag tweet/nap (teljes idő)", value: fmtNum(avgPerDay) },
    { label: "Utolsó 7 nap átlaga", value: fmtNum(last7Avg) },
    { label: "Legaktívabb nap", value: `${busiest.date} (${busiest.count})` },
  ];

  grid.innerHTML = cards
    .map(
      (c) => `
      <div class="result-card">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(c.value)}</div>
      </div>`
    )
    .join("");
}

function renderDailyChart(series) {
  const rolling = rollingAverage(series, 7);
  const ctx = document.getElementById("dailyChart");
  if (dailyChartInstance) dailyChartInstance.destroy();
  dailyChartInstance = new Chart(ctx, {
    data: {
      labels: series.map((p) => p.date),
      datasets: [
        {
          type: "bar",
          label: "Tweet/nap",
          data: series.map((p) => p.count),
          backgroundColor: "#4f8cff55",
          borderColor: "#4f8cff",
          borderWidth: 1,
        },
        {
          type: "line",
          label: "7 napos mozgóátlag",
          data: rolling.map((p) => p.avg),
          borderColor: "#2ecc71",
          backgroundColor: "#2ecc71",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: "#8b93a7", maxTicksLimit: 16, autoSkip: true }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { labels: { color: "#e6e9f0" } } },
    },
  });
}

function renderWeekdayChart(series) {
  const averages = dayOfWeekAverages(series);
  const ctx = document.getElementById("weekdayChart");
  if (weekdayChartInstance) weekdayChartInstance.destroy();
  weekdayChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: WEEKDAY_NAMES_HU,
      datasets: [
        {
          label: "Átlag tweet/nap",
          data: averages,
          backgroundColor: "#f5b94255",
          borderColor: "#f5b942",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderHourChart(entries) {
  const counts = hourOfDayCounts(entries);
  const labels = counts.map((_, h) => `${String(h).padStart(2, "0")}:00`);
  const ctx = document.getElementById("hourChart");
  if (hourChartInstance) hourChartInstance.destroy();
  hourChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Tweetek száma (UTC óra)",
          data: counts,
          backgroundColor: "#e05a5a55",
          borderColor: "#e05a5a",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: "#8b93a7", maxTicksLimit: 24 }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { display: false } },
    },
  });
}

async function load() {
  statusEl.textContent = "Frissítés...";
  try {
    const entries = await fetchAllTweetLog();
    if (!entries.length) {
      statusEl.textContent = "Még nincs naplózott adat - a bot első futása után jelenik meg.";
      return;
    }
    const dailyCounts = aggregateDailyCounts(entries);
    const series = fillDailySeries(dailyCounts);

    renderSummary(entries, series);
    renderDailyChart(series);
    renderWeekdayChart(series);
    renderHourChart(entries);

    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba: " + e.message;
  }
}

document.getElementById("refreshBtn").addEventListener("click", load);
load();
