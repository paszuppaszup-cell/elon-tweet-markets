const REFRESH_MS = 60000;
const listEl = document.getElementById("list");
const statusEl = document.getElementById("statusText");
const refreshBtn = document.getElementById("refreshBtn");

function fmtPct(p) {
  return (p * 100).toFixed(1) + "%";
}

function renderEvents(events, liveStates) {
  if (!events.length) {
    listEl.innerHTML = '<p class="muted">Nincs jelenleg aktív Elon Musk tweet-szám piac.</p>';
    return;
  }

  events.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

  listEl.innerHTML = events
    .map((ev) => {
      const buckets = (ev.markets || [])
        .filter((m) => m.active && !m.closed)
        .map(normalizeMarket)
        .filter((m) => m.prices.length)
        .sort((a, b) => b.prices[0] - a.prices[0]);

      const top3 = buckets.slice(0, 3);
      const weekly = isWeeklyRangeEvent(ev);

      const chips = top3
        .map((b) => {
          const label = b.groupItemTitle || b.outcomes[0] || "?";
          return `<span class="chip">${escapeHtml(label)}: <b>${fmtPct(b.prices[0])}</b></span>`;
        })
        .join("");

      const liveState = liveStates.get(ev.id);
      const liveLine = liveState
        ? `Jelenleg <b>${liveState.count}</b> tweetnél tart · <b>${liveState.daysRemaining > 0 ? liveState.daysRemaining.toFixed(1) : "0"} nap</b> van hátra`
        : "";

      return `
        <a class="card" href="market.html?id=${encodeURIComponent(ev.id)}">
          <div class="card-head">
            <h3>${escapeHtml(ev.title)}</h3>
            <span class="badge ${weekly ? "" : "monthly"}">${weekly ? "heti" : "havi"}</span>
          </div>
          <div class="muted" style="font-size:13px;margin-top:4px;">
            Zárás: ${new Date(ev.endDate).toLocaleString("hu-HU")} · Volumen: $${Number(ev.volume || 0).toLocaleString("hu-HU", { maximumFractionDigits: 0 })}
          </div>
          ${liveLine ? `<div class="muted" style="font-size:13px;margin-top:2px;">${liveLine}</div>` : ""}
          <div class="bucket-preview">${chips}</div>
        </a>
      `;
    })
    .join("");
}

async function load() {
  statusEl.textContent = "Frissítés...";
  try {
    const events = await searchElonTweetEvents();

    let liveStates = new Map();
    try {
      const [posts, trackings] = await Promise.all([fetchElonPosts(), fetchElonTrackings()]);
      for (const ev of events) {
        const state = computeEventLiveState(ev, posts, trackings);
        if (state) liveStates.set(ev.id, state);
      }
    } catch (e) {
      /* elo tweet-szam nem elerheto - a lista attol meg megjelenik */
    }

    renderEvents(events, liveStates);
    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba az adatok betöltésekor: " + e.message;
  }
}

refreshBtn.addEventListener("click", load);
load();
setInterval(load, REFRESH_MS);
