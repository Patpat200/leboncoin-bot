// public/app.js

const guildSelect = document.getElementById("guild-select");
const channelSelect = document.getElementById("channel-select");
const watchForm = document.getElementById("watch-form");
const createStatus = document.getElementById("create-status");
const watchesTableEl = document.getElementById("watches-table");
const feedListEl = document.getElementById("feed-list");
const onlyDealsCheckbox = document.getElementById("only-deals");
const sortOrderSelect = document.getElementById("sort-order");

let guildsCache = [];

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

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

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
      const lines = [
        `Surveillance "${data.watch.query}" créée (id ${data.watch.id}).`,
        `${data.totalFound} annonce(s) trouvée(s), ${data.alertedCount} postée(s) sur Discord` +
          (data.dealsFound ? ` (${data.dealsFound} 🔥)` : "") + ".",
      ];
      if (data.refPriceError) lines.push(`⚠️ Prix Amazon non récupéré : ${data.refPriceError}`);
      if (data.geoWarning) lines.push(`⚠️ ${data.geoWarning}`);
      createStatus.textContent = lines.join("\n");
      watchForm.reset();
      refreshAll();
    }
  } catch (err) {
    createStatus.textContent = `Erreur réseau : ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Liste des surveillances
// ---------------------------------------------------------------------------
async function loadWatches() {
  const res = await fetch("/api/watches");
  const watches = await res.json();

  if (watches.length === 0) {
    watchesTableEl.innerHTML = `<p class="empty">Aucune surveillance pour l'instant.</p>`;
    return;
  }

  const rows = watches.map((w) => `
    <tr>
      <td>
        <strong>${escapeHtml(w.query)}</strong><br/>
        <span style="color:var(--muted);font-size:0.78rem">${w.id}</span>
      </td>
      <td>
        ${w.max_price ? `max ${w.max_price}€<br/>` : ""}
        ${w.zipcode ? `📍 ${escapeHtml(w.zipcode)} (${w.radius_km}km)` : ""}
      </td>
      <td>${w.ref_price ? `~${Math.round(w.ref_price)}€<br/><span style="color:var(--muted);font-size:0.72rem">${
        w.ref_price_source === "amazon" ? "Amazon" : w.ref_price_source === "leboncoin_median" ? "médiane LBC" : "manuel"
      }</span>` : "—"}</td>
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
  loadWatches();
});

// ---------------------------------------------------------------------------
// Flux des annonces
// ---------------------------------------------------------------------------
async function loadFeed() {
  const onlyDeals = onlyDealsCheckbox?.checked ? "true" : "false";
  const res = await fetch(`/api/listings?onlyDeals=${onlyDeals}`);
  let listings = await res.json();

  const sortOrder = sortOrderSelect?.value || "recent";
  if (sortOrder === "price_asc") {
    listings = [...listings].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  } else if (sortOrder === "price_desc") {
    listings = [...listings].sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  }
  // "recent" : on garde l'ordre renvoyé par l'API (déjà trié par date desc)

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

onlyDealsCheckbox?.addEventListener("change", loadFeed);
sortOrderSelect?.addEventListener("change", loadFeed);

// ---------------------------------------------------------------------------
// Rafraîchissement périodique
// ---------------------------------------------------------------------------
function refreshAll() {
  loadWatches();
  loadFeed();
}

loadGuilds();
refreshAll();
setInterval(refreshAll, 15000);
