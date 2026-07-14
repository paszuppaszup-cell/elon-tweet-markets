const WEEKDAY_NAMES_HU = ["Vas", "Hét", "Kedd", "Szer", "Csüt", "Pén", "Szo"];
const WEEKDAY_NAMES_FULL_HU = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
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
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8b93a7", maxTicksLimit: 16, autoSkip: true }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { labels: COMPACT_LEGEND } },
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
      maintainAspectRatio: false,
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
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8b93a7", maxTicksLimit: 24 }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function buildConclusion(ins, curL, prevL, faster) {
  if (ins.paceDeltaPct === null) {
    return `${escapeHtml(curL)} még korai szakaszban van, egyelőre kevés az adat a megbízható következtetéshez.`;
  }
  const dir = faster ? "aktívabb" : "csendesebb";
  let s = `${escapeHtml(curL)} eddig érezhetően ${dir}, mint ${escapeHtml(prevL)} volt`;
  if (ins.trend === "accelerating") s += ", és a tempó a hónapon belül tovább gyorsul";
  else if (ins.trend === "slowing") s += ", és a tempó a hónapon belül tovább lassul";
  else if (ins.trend === "stable") s += ", a tempó pedig stabilan tartja magát";
  s += ". ";
  if (ins.cur.isOngoing) {
    const higher = ins.cur.projectedMonthTotal >= ins.prev.count;
    s += `Ha ez így marad, a hónap kb. <b>${fmtNum(ins.cur.projectedMonthTotal, 0)}</b> tweettel zár, ami ${
      higher ? "több" : "kevesebb"
    }, mint ${escapeHtml(prevL)} ${ins.prev.count} tweetje.`;
  }
  return s;
}

function renderMonthInsights(entries) {
  const box = document.getElementById("monthInsightsBox");
  const ins = buildMonthInsights(entries, Date.now());
  const curL = monthLabel(ins.curYear, ins.curMonth);
  const prevL = monthLabel(ins.prevYear, ins.prevMonth);

  if (!ins.cur.count) {
    box.innerHTML = `<p class="muted">${escapeHtml(curL)}-ban még nincs naplózott tweet — amint jön adat, itt megjelenik az elemzés.</p>`;
    return;
  }

  const faster = ins.paceDeltaPct !== null && ins.paceDeltaPct >= 0;
  const paceColor = faster ? "var(--green)" : "var(--red)";
  const trendWord =
    ins.trend === "accelerating"
      ? "gyorsul"
      : ins.trend === "slowing"
      ? "lassul"
      : ins.trend === "stable"
      ? "nagyjából stabil"
      : null;

  const lines = [];
  lines.push(
    `Elon eddig <b>${ins.cur.count}</b> tweetet írt ${escapeHtml(curL)} folyamán, az eltelt <b>${ins.cur.daysElapsed.toFixed(
      1
    )} nap</b> alatt — ez napi <b>${fmtNum(ins.cur.avgPerDay)}</b> tweet átlag.`
  );
  if (ins.paceDeltaPct !== null) {
    lines.push(
      `Ez az előző hónaphoz (${escapeHtml(prevL)}: napi ${fmtNum(ins.prev.avgPerDay)}) képest <b style="color:${paceColor};">${fmtNum(
        Math.abs(ins.paceDeltaPct)
      )}%-kal ${faster ? "gyorsabb" : "lassabb"}</b>.`
    );
  }
  if (ins.cur.isOngoing) {
    lines.push(
      `A mostani tempóval a hónap végére kb. <b>${fmtNum(ins.cur.projectedMonthTotal, 0)}</b> tweet várható (${escapeHtml(
        prevL
      )} összesen: ${ins.prev.count}).`
    );
  }
  if (ins.busiestDayDate) {
    lines.push(`A legaktívabb nap eddig <b>${ins.busiestDayDate}</b> volt (${ins.busiestDayCount} tweet).`);
  }
  if (ins.busiestHour >= 0) {
    lines.push(
      `Napon belül jellemzően <b>${String(ins.busiestHour).padStart(2, "0")}:00 (UTC)</b> körül a legaktívabb (átlag ${fmtNum(
        ins.busiestHourPerDay,
        2
      )} tweet ebben az órában naponta).`
    );
  }
  if (ins.busiestWeekday >= 0) {
    lines.push(
      `A hét napjai közül eddig <b>${WEEKDAY_NAMES_FULL_HU[ins.busiestWeekday]}</b> a legaktívabb (átlag ${fmtNum(
        ins.busiestWeekdayAvg
      )} tweet/nap).`
    );
  }
  if (trendWord) {
    lines.push(
      `Az elmúlt ${Math.min(3, ins.completedDays)} lezárt nap tempója a havi átlaghoz mérve: <b>${trendWord}</b> (utóbbi napok: ${fmtNum(
        ins.recentAvg
      )}/nap vs. havi ${fmtNum(ins.monthAvgCompleted)}/nap).`
    );
  }

  const conclusion = buildConclusion(ins, curL, prevL, faster);

  box.innerHTML = `
    <p class="muted" style="font-size:13px;line-height:1.75;">${lines.join(" ")}</p>
    <div style="margin-top:12px;padding:10px 14px;border-left:3px solid var(--accent);background:rgba(127,127,127,0.08);border-radius:4px;font-size:13px;line-height:1.6;">
      <b>Következtetés (${escapeHtml(curL)}):</b> ${conclusion}
    </div>
  `;
}

function renderForecast(entries, newsVol) {
  const box = document.getElementById("forecastBox");
  const fc = buildTweetForecast(entries, newsVol, Date.now());

  if (fc.momentum == null) {
    box.innerHTML = '<p class="muted">Nincs elég adat az előrejelzéshez.</p>';
    return;
  }

  const exp = Math.round(fc.momentum);
  const lo = Math.max(0, Math.round(fc.momentum - fc.band));
  const hi = Math.round(fc.momentum + fc.band);

  const riskMap = {
    low: { label: "Alacsony", color: "var(--green)", dot: "🟢" },
    medium: { label: "Közepes", color: "var(--yellow)", dot: "🟡" },
    high: { label: "Magas", color: "var(--red)", dot: "🔴" },
  };
  const rk = riskMap[fc.risk];
  const reason = fc.factors.length
    ? fc.factors.map((f) => escapeHtml(f.text)).join(" · ")
    : "nincs kiemelt kockázati tényező";

  box.innerHTML = `
    <div class="result-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="result-card">
        <div class="label">Várható napi tweetszám</div>
        <div class="value" style="font-size:30px;">~${exp}</div>
        <div class="muted" style="font-size:12px;">jellemzően ${lo}–${hi} között (14 napos tempó)</div>
      </div>
      <div class="result-card">
        <div class="label">Ma eddig</div>
        <div class="value">${fc.todayCount}</div>
        <div class="muted" style="font-size:12px;">tweet a mai napon</div>
      </div>
      <div class="result-card">
        <div class="label">Spike-kockázat (kiugró nap)</div>
        <div class="value" style="color:${rk.color};">${rk.dot} ${rk.label}</div>
        <div class="muted" style="font-size:12px;">${reason}</div>
      </div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:10px;">
      A szám a bizonyítottan legjobb egyszerű előrejelző (14 napos átlag, átlagos hiba ±12).
      A napi ingadozás nagy része esemény-vezérelt — a kockázat-jelző mutatja, mikor várható kiugrás.
    </p>
  `;
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

// Regi->uj sorrendben: az utolso (jelenlegi honap) mindig a legszembetunobb
// (kek), a korabbi honapok halvanyulo szurketol-liaig terjedo skalan.
const MONTH_COMPARE_COLORS = ["#8b93a7", "#9b7fd4", "#f5b942", "#4f8cff"];

// Rovid honap-felirat a 4-honapos osszehasonlito grafikonok jelmagyarazatahoz
// - a teljes "2026. julius" 4 darabbol mar nem fer ki egy sorba keskeny
// (mobil) kepernyon, a Chart.js pedig 2 sorra tori, ami a szuk konteneren
// belul ratolodhat a diagram tetejere. Rovidebb felirattal (pl. "aug '26")
// tobbnyire egy sorban marad.
const MONTH_ABBR_HU = ["jan", "febr", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
function monthLabelShort(year, monthIndex0) {
  return `${MONTH_ABBR_HU[monthIndex0]} '${String(year).slice(2)}`;
}

const COMPACT_LEGEND = { color: "#e6e9f0", boxWidth: 10, font: { size: 10 }, padding: 6 };

function renderDayOfMonthChart(entries, months, nowMs) {
  const seriesList = months.map((m) => dayOfMonthCounts(entries, m.year, m.monthIndex0, nowMs));
  const maxLen = Math.max(...seriesList.map((s) => s.length));
  const labels = Array.from({ length: maxLen }, (_, i) => i + 1);

  const ctx = document.getElementById("dayOfMonthChart");
  if (dayOfMonthChartInstance) dayOfMonthChartInstance.destroy();
  dayOfMonthChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: months.map((m, i) => ({
        label: monthLabelShort(m.year, m.monthIndex0),
        data: padSeries(seriesList[i], maxLen),
        backgroundColor: MONTH_COMPARE_COLORS[i] + "55",
        borderColor: MONTH_COMPARE_COLORS[i],
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8b93a7", maxTicksLimit: 10, autoSkip: true }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { labels: COMPACT_LEGEND } },
    },
  });
}

function renderWeekOfMonthChart(entries, months, nowMs) {
  const seriesList = months.map((m) => weekOfMonthCounts(dayOfMonthCounts(entries, m.year, m.monthIndex0, nowMs)));
  const maxLen = Math.max(...seriesList.map((s) => s.length));
  const labels = Array.from({ length: maxLen }, (_, i) => `${i + 1}. hét`);

  const ctx = document.getElementById("weekOfMonthChart");
  if (weekOfMonthChartInstance) weekOfMonthChartInstance.destroy();
  weekOfMonthChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: months.map((m, i) => ({
        label: monthLabelShort(m.year, m.monthIndex0),
        data: padSeries(seriesList[i], maxLen),
        backgroundColor: MONTH_COMPARE_COLORS[i] + "55",
        borderColor: MONTH_COMPARE_COLORS[i],
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { labels: COMPACT_LEGEND } },
    },
  });
}

function renderHourCompareChart(entries, months, nowMs) {
  // Nyers darabszam helyett napi atlag (darabszam / az adott honapban eddig
  // eltelt napok) - kulonben egy rovidebb (pl. folyamatban levo) honap
  // aranytalanul kisebbnek latszana, csak azert, mert kevesebb nap telt el,
  // nem pedig a napi ritmus miatt. Igy minden honap kozvetlenul osszevetheto.
  const daysElapsedList = months.map((m) => summarizeMonth(entries, m.year, m.monthIndex0, nowMs).daysElapsed);
  const rawList = months.map((m) => hourOfDayCountsForMonth(entries, m.year, m.monthIndex0));
  const perDayList = rawList.map((raw, i) => raw.map((c) => (daysElapsedList[i] > 0 ? c / daysElapsedList[i] : 0)));
  const labels = rawList[0].map((_, h) => `${String(h).padStart(2, "0")}:00`);

  const ctx = document.getElementById("hourCompareChart");
  if (hourCompareChartInstance) hourCompareChartInstance.destroy();
  hourCompareChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: months.map((m, i) => ({
        label: monthLabelShort(m.year, m.monthIndex0),
        data: perDayList[i],
        backgroundColor: MONTH_COMPARE_COLORS[i] + "55",
        borderColor: MONTH_COMPARE_COLORS[i],
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8b93a7", maxTicksLimit: 24 }, grid: { color: "#232b3d" } },
        y: { ticks: { color: "#8b93a7" }, grid: { color: "#232b3d" }, beginAtZero: true },
      },
      plugins: { legend: { labels: COMPACT_LEGEND } },
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

    let newsVol = [];
    try {
      newsVol = await fetchNewsVolume();
    } catch (e) {
      /* hir-volumen nem elerheto - az elorejelzo szam attol meg mukodik, csak a hir-faktor marad ki a kockazatbol */
    }
    renderForecast(entries, newsVol);
    renderMonthInsights(entries);
    renderSummary(entries, series);
    renderDailyChart(series);
    renderWeekdayChart(series);
    renderHourChart(entries);

    renderMonthCompareSummary(entries);
    const nowMs = Date.now();
    const recentMonths = getRecentMonths(nowMs, 4);
    renderDayOfMonthChart(entries, recentMonths, nowMs);
    renderWeekOfMonthChart(entries, recentMonths, nowMs);
    renderHourCompareChart(entries, recentMonths, nowMs);

    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba: " + e.message;
  }
}

document.getElementById("refreshBtn").addEventListener("click", load);
load();
