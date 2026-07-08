const WEEKDAY_NAMES_HU = ["Vas", "Hét", "Kedd", "Szer", "Csüt", "Pén", "Szo"];
const statusEl = document.getElementById("statusText");

let dailyChartInstance = null;
let weekdayChartInstance = null;
let hourChartInstance = null;
let dayOfMonthChartInstance = null;
let weekOfMonthChartInstance = null;
let hourCompareChartInstance = null;

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

function monthLabel(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0, 1)).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "long",
  });
}

function getPrevAndCurrentMonth() {
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth();
  let prevYear = curYear;
  let prevMonth = curMonth - 1;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear -= 1;
  }
  return { curYear, curMonth, prevYear, prevMonth };
}

function renderMonthCompareSummary(entries) {
  const nowMs = Date.now();
  const { curYear, curMonth, prevYear, prevMonth } = getPrevAndCurrentMonth();

  const prev = summarizeMonth(entries, prevYear, prevMonth, nowMs);
  const cur = summarizeMonth(entries, curYear, curMonth, nowMs);

  const rows = [
    { label: "Napi átlag (tweet/nap)", prev: fmtNum(prev.avgPerDay), cur: fmtNum(cur.avgPerDay) },
    { label: "Heti átlag (tweet/hét)", prev: fmtNum(prev.avgPerWeek), cur: fmtNum(cur.avgPerWeek) },
    { label: "Órás átlag (tweet/óra)", prev: fmtNum(prev.avgPerHour, 2), cur: fmtNum(cur.avgPerHour, 2) },
    {
      label: "Havi összesen",
      prev: prev.count.toLocaleString("hu-HU"),
      cur: cur.isOngoing
        ? `${cur.count.toLocaleString("hu-HU")} eddig (becsült teljes hónap: ${fmtNum(cur.projectedMonthTotal, 0)})`
        : cur.count.toLocaleString("hu-HU"),
    },
  ];

  const pctChange = prev.avgPerDay > 0 ? ((cur.avgPerDay - prev.avgPerDay) / prev.avgPerDay) * 100 : null;
  const pctLabel =
    pctChange === null
      ? ""
      : ` · napi tempó változása: <b style="color:${pctChange >= 0 ? "var(--green)" : "var(--red)"};">${
          pctChange >= 0 ? "+" : ""
        }${fmtNum(pctChange)}%</b>`;

  document.getElementById("monthCompareBox").innerHTML = `
    <p class="muted" style="font-size:13px;">
      ${escapeHtml(monthLabel(prevYear, prevMonth))} (teljes hónap, ${prev.totalDaysInMonth} nap) vs.
      ${escapeHtml(monthLabel(curYear, curMonth))}
      (eddig ${cur.daysElapsed.toFixed(1)} nap telt el a ${cur.totalDaysInMonth}-ból)${pctLabel}
    </p>
    <table>
      <thead>
        <tr><th></th><th>${escapeHtml(monthLabel(prevYear, prevMonth))}</th><th>${escapeHtml(monthLabel(curYear, curMonth))}</th></tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${r.prev}</td><td>${r.cur}</td></tr>`)
          .join("")}
      </tbody>
    </table>
  `;

  return { prev, cur, prevYear, prevMonth, curYear, curMonth };
}

function renderDayOfMonthChart(entries, prevYear, prevMonth, curYear, curMonth) {
  const prevCounts = dayOfMonthCounts(entries, prevYear, prevMonth);
  const curCounts = dayOfMonthCounts(entries, curYear, curMonth);
  const maxLen = Math.max(prevCounts.length, curCounts.length);
  const labels = Array.from({ length: maxLen }, (_, i) => i + 1);

  const ctx = document.getElementById("dayOfMonthChart");
  if (dayOfMonthChartInstance) dayOfMonthChartInstance.destroy();
  dayOfMonthChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: monthLabel(prevYear, prevMonth),
          data: padSeries(prevCounts, maxLen),
          backgroundColor: "#8b93a755",
          borderColor: "#8b93a7",
          borderWidth: 1,
        },
        {
          label: monthLabel(curYear, curMonth),
          data: padSeries(curCounts, maxLen),
          backgroundColor: "#4f8cff55",
          borderColor: "#4f8cff",
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
      plugins: { legend: { labels: { color: "#e6e9f0" } } },
    },
  });
}

function renderWeekOfMonthChart(entries, prevYear, prevMonth, curYear, curMonth) {
  const prevWeeks = weekOfMonthCounts(dayOfMonthCounts(entries, prevYear, prevMonth));
  const curWeeks = weekOfMonthCounts(dayOfMonthCounts(entries, curYear, curMonth));
  const maxLen = Math.max(prevWeeks.length, curWeeks.length);
  const labels = Array.from({ length: maxLen }, (_, i) => `${i + 1}. hét`);

  const ctx = document.getElementById("weekOfMonthChart");
  if (weekOfMonthChartInstance) weekOfMonthChartInstance.destroy();
  weekOfMonthChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: monthLabel(prevYear, prevMonth),
          data: padSeries(prevWeeks, maxLen),
          backgroundColor: "#8b93a755",
          borderColor: "#8b93a7",
          borderWidth: 1,
        },
        {
          label: monthLabel(curYear, curMonth),
          data: padSeries(curWeeks, maxLen),
          backgroundColor: "#2ecc7155",
          borderColor: "#2ecc71",
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
      plugins: { legend: { labels: { color: "#e6e9f0" } } },
    },
  });
}

function renderHourCompareChart(entries, prevYear, prevMonth, curYear, curMonth) {
  const prevCounts = hourOfDayCountsForMonth(entries, prevYear, prevMonth);
  const curCounts = hourOfDayCountsForMonth(entries, curYear, curMonth);
  const labels = prevCounts.map((_, h) => `${String(h).padStart(2, "0")}:00`);

  const ctx = document.getElementById("hourCompareChart");
  if (hourCompareChartInstance) hourCompareChartInstance.destroy();
  hourCompareChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: monthLabel(prevYear, prevMonth),
          data: prevCounts,
          backgroundColor: "#8b93a755",
          borderColor: "#8b93a7",
          borderWidth: 1,
        },
        {
          label: monthLabel(curYear, curMonth),
          data: curCounts,
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
      plugins: { legend: { labels: { color: "#e6e9f0" } } },
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

    const { prevYear, prevMonth, curYear, curMonth } = renderMonthCompareSummary(entries);
    renderDayOfMonthChart(entries, prevYear, prevMonth, curYear, curMonth);
    renderWeekOfMonthChart(entries, prevYear, prevMonth, curYear, curMonth);
    renderHourCompareChart(entries, prevYear, prevMonth, curYear, curMonth);

    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba: " + e.message;
  }
}

document.getElementById("refreshBtn").addEventListener("click", load);
load();
