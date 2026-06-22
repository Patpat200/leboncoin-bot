// public/app.js

const guildSelect = document.getElementById("guild-select");
const channelSelect = document.getElementById("channel-select");
const watchForm = document.getElementById("watch-form");
const createStatus = document.getElementById("create-status");
const watchesTableEl = document.getElementById("watches-table");
const feedListEl = document.getElementById("feed-list");
const onlyDealsCheckbox = document.getElementById("only-deals");
const sortOrderSelect = document.getElementById("sort-order");
const connectionStatusEl = document.getElementById("connection-status");

let guildsCache = [];
let watchesCache = [];
let listingsCache = [];
const MAX_LISTINGS_CACHE = 300;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------------
// Socket.IO — toutes les mises à jour arrivent en direct, pas de polling.
// ---------------------------------------------------------------------------
const socket = io();

socket.on("connect", () => {
  connectionStatusEl.textContent = "🟢 Connecté";
  connectionStatusEl.className = "conn-status online";
});

socket.on("disconnect", () => {
  connectionStatusEl.textContent = "🔴 Déconnecté — tentative de reconnexion…";
  connectionStatusEl.className = "conn-status offline";
});

socket.on("watch:created", (watch) => {
  watchesCache.push(watch);
  renderWatchesTable();
});

socket.on("watch:updated", (watch) => {
  const idx = watchesCache.findIndex((w) => w.id === watch.id);
  if (idx !== -1) watchesCache[idx] = watch;
  else watchesCache.push(watch);
  renderWatchesTable();
});

socket.on("watch:deleted", ({ id }) => {
  watchesCache = watchesCache.filter((w) => w.id !== id);
  renderWatchesTable();
});

socket.on("listing:new", (listing) => {
  listingsCache.unshift(listing);
  if (listingsCache.length > MAX_LISTINGS_CACHE) {
    listingsCache.length = MAX_LISTINGS_CACHE;
  }
  renderFeed();
});

// ---------------------------------------------------------------------------
// Formulaire : serveurs / salons Discord
// ---------------------------------------------------------------------------
async function loadGuilds() {
  const res = await fetch("/api/guilds");
  guildsCache = await res.json();

  guildSelect.innerHTML = guildsCache
    .map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`)
    .join("");

  updateChannelOptions();
}

function updateChannelOptions() {
  const guild = guildsCache.find((g) => g.id === guildSelect.value);
  const channels = guild ? guild.channels : [];
  channelSelect.innerHTML = channels
    .map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`)
    .join("");
}

guildSelect?.addEventListener("change", updateChannelOptions);

// ---------------------------------------------------------------------------
// Création d'une surveillance
// ---------------------------------------------------------------------------
watchForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = watchForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  createStatus.textContent = "Création + recherche immédiate en cours…";

  const formData = new FormData(watchForm);
  const payload = {
    query: formData.get("query"),
    maxPrice: formData.get("maxPrice") ? Number(formData.get("maxPrice")) : null,
    refPrice: formData.get("refPrice") ? Number(formData.get("refPrice")) : null,
    zipcode: formData.get("zipcode") || null,
    radiusKm: formData.get("radiusKm") ? Number(formData.get("radiusKm")) : null,
    guildId: guildSelect.value,
    channelId: channelSelect.value,
  };

  try {
    const res = await fetch("/api/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      createStatus.textContent = `Erreur : ${data.error || "inconnue"}`;
    } else {
      // Le watch + les annonces arrivent normalement déjà via Socket.IO,
      // ceci est juste un résumé immédiat dans le formulaire.
      const lines = [
        `Surveillance "${data.watch.query}" créée (id ${data.watch.id}).`,
        `${data.totalFound} annonce(s) trouvée(s), ${data.alertedCount} postée(s) sur Discord` +
          (data.dealsFound ? ` (${data.dealsFound} 🔥)` : "") + ".",
      ];
      if (data.refPriceErrors?.amazonError && !data.refPriceInfo) {
        lines.push(`⚠️ Référence non trouvée : ${data.refPriceErrors.amazonError}`);
      }
      if (data.geoWarning) lines.push(`⚠️ ${data.geoWarning}`);
      createStatus.textContent = lines.join("\n");
      watchForm.reset();
    }
  } catch (err) {
    createStatus.textContent = `Erreur réseau : ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Surveillances (chargement initial + rendu, mises à jour via socket ensuite)
// ---------------------------------------------------------------------------
async function loadWatches() {
  const res = await fetch("/api/watches");
  watchesCache = await res.json();
  renderWatchesTable();
}

function renderWatchesTable() {
  if (watchesCache.length === 0) {
    watchesTableEl.innerHTML = `<p class="empty">Aucune surveillance pour l'instant.</p>`;
    return;
  }

  const sourceLabel = (w) =>
    w.ref_price_source === "amazon" ? "Amazon"
    : w.ref_price_source === "leboncoin_median" ? "médiane LBC"
    : "manuel";

  const rows = [...watchesCache]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((w) => `
      <tr>
        <td>
          <strong>${escapeHtml(w.query)}</strong><br/>
          <span style="color:var(--muted);font-size:0.78rem">${w.id}</span>
        </td>
        <td>
          ${w.max_price ? `max ${w.max_price}€<br/>` : ""}
          ${w.zipcode ? `📍 ${escapeHtml(w.zipcode)} (${w.radius_km}km)` : ""}
        </td>
        <td>${w.ref_price
          ? `~${Math.round(w.ref_price)}€<br/><span style="color:var(--muted);font-size:0.72rem">${sourceLabel(w)}</span>`
          : "—"}</td>
        <td><span class="badge ${w.paused ? "paused" : "active"}">${w.paused ? "En pause" : "Actif"}</span></td>
        <td class="row-actions">
          ${w.paused
            ? `<button data-action="resume" data-id="${w.id}">▶️ Reprendre</button>`
            : `<button data-action="pause" data-id="${w.id}">⏸️ Pause</button>`}
          <button data-action="delete" data-id="${w.id}" class="danger">🗑️</button>
        </td>
      </tr>
    `).join("");

  watchesTableEl.innerHTML = `
    <table>
      <thead>
        <tr><th>Recherche</th><th>Filtres</th><th>Réf.</th><th>Statut</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

watchesTableEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === "delete" && !confirm("Supprimer définitivement cette surveillance ?")) return;

  const url = action === "delete" ? `/api/watches/${id}` : `/api/watches/${id}/${action}`;
  const method = action === "delete" ? "DELETE" : "POST";
  await fetch(url, { method });
  // Pas besoin de recharger : le serveur émet watch:updated / watch:deleted,
  // qui mettent déjà à jour watchesCache via le socket.
});

// ---------------------------------------------------------------------------
// Flux des annonces (chargement initial + rendu, mises à jour via socket)
// ---------------------------------------------------------------------------
async function loadFeed() {
  const res = await fetch("/api/listings");
  listingsCache = await res.json();
  renderFeed();
}

function renderFeed() {
  let listings = listingsCache;

  if (onlyDealsCheckbox?.checked) {
    listings = listings.filter((l) => l.is_deal);
  }

  const sortOrder = sortOrderSelect?.value || "recent";
  if (sortOrder === "price_asc") {
    listings = [...listings].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  } else if (sortOrder === "price_desc") {
    listings = [...listings].sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  }
  // "recent" : ordre d'arrivée déjà décroissant par date (cache + flux live)

  if (listings.length === 0) {
    feedListEl.innerHTML = `<p class="empty">Aucune annonce pour l'instant.</p>`;
    return;
  }

  feedListEl.innerHTML = listings.map((l) => `
    <div class="listing-card">
      ${l.image ? `<img src="${escapeHtml(l.image)}" alt="" loading="lazy" />` : ""}
      <div class="listing-info">
        <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">
          ${l.is_deal ? '<span class="deal-tag">🔥 </span>' : ""}${escapeHtml(l.title)}
        </a>
        <div class="listing-meta">
          ${l.price != null ? `${l.price}€` : "Prix non précisé"}
          ${l.location ? ` · 📍 ${escapeHtml(l.location)}` : ""}
          · recherche "${escapeHtml(l.watch_query)}"
          · ${new Date(l.seen_at).toLocaleString("fr-FR")}
        </div>
      </div>
    </div>
  `).join("");
}

onlyDealsCheckbox?.addEventListener("change", renderFeed);
sortOrderSelect?.addEventListener("change", renderFeed);

// ---------------------------------------------------------------------------
// Chargement initial (les mises à jour suivantes arrivent via Socket.IO)
// ---------------------------------------------------------------------------
loadGuilds();
loadWatches();
loadFeed();
