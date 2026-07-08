const LANG_LABELS = { en: "Angol", hu: "Magyar" };
const statusEl = document.getElementById("statusText");
const langFilterEl = document.getElementById("langFilter");
const newsListEl = document.getElementById("newsList");

let allItems = [];
let activeLang = "all";

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderLangFilter() {
  const options = [
    { key: "all", label: "Mind" },
    { key: "en", label: "Angol" },
    { key: "hu", label: "Magyar" },
  ];
  langFilterEl.innerHTML = options
    .map(
      (o) => `
      <label class="chip chip-toggle ${activeLang === o.key ? "checked" : ""}" data-lang="${o.key}">
        <input type="radio" name="langFilter" ${activeLang === o.key ? "checked" : ""}>
        ${escapeHtml(o.label)}
      </label>`
    )
    .join("");

  langFilterEl.querySelectorAll(".chip-toggle").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeLang = chip.dataset.lang;
      renderLangFilter();
      renderNewsList();
    });
  });
}

function renderNewsList() {
  const items = (activeLang === "all" ? allItems : allItems.filter((it) => it.lang === activeLang)).filter((it) =>
    isSafeHttpUrl(it.link)
  );

  if (!items.length) {
    newsListEl.innerHTML = '<p class="muted">Nincs megjeleníthető hír ezzel a szűréssel.</p>';
    return;
  }

  newsListEl.innerHTML = items
    .map((it) => {
      const safeLink = escapeHtml(it.link);
      const langBadge = LANG_LABELS[it.lang] || it.lang;
      return `
        <a class="card" href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display:block;margin-bottom:10px;">
          <div class="card-head">
            <h3 style="font-size:16px;">${escapeHtml(it.title)}</h3>
            <span class="badge">${escapeHtml(langBadge)}</span>
          </div>
          <div class="muted" style="font-size:13px;margin-top:4px;">
            ${it.source ? escapeHtml(it.source) + " · " : ""}${fmtDate(it.published_at)}
          </div>
        </a>`;
    })
    .join("");
}

async function load() {
  statusEl.textContent = "Frissítés...";
  try {
    allItems = await fetchNewsLog(150);
    renderLangFilter();
    renderNewsList();
    statusEl.textContent = "Utolsó frissítés: " + new Date().toLocaleTimeString("hu-HU");
  } catch (e) {
    statusEl.textContent = "Hiba: " + e.message;
  }
}

document.getElementById("refreshBtn").addEventListener("click", load);
load();
