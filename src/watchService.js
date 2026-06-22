// src/watchService.js
import { randomUUID } from "crypto";
import { searchLeboncoin, getMarketReferencePrice } from "./leboncoin.js";
import { getReferencePrice } from "./amazon.js";
import { geocodeZipcode } from "./geocode.js";
import { buildEmbed } from "./embeds.js";
import { addWatch, filterUnseen, markSeen } from "./db.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_RADIUS_KM = Number(process.env.DEFAULT_RADIUS_KM) || 20;

/**
 * Détermine un prix de référence pour la recherche, avec repli automatique :
 * 1. Amazon (best effort — bloque souvent, voir amazon.js)
 * 2. Médiane des annonces actuelles sur Leboncoin lui-même (toujours
 *    disponible, plus pertinente pour comparer de l'occasion à de l'occasion)
 */
export async function fetchReferencePrice(query) {
  let amazonInfo = null;
  let amazonError = null;
  try {
    amazonInfo = await getReferencePrice(query);
  } catch (e) {
    amazonError = e.message;
  }

  if (amazonInfo) {
    return { refPrice: amazonInfo.average, source: "amazon", info: amazonInfo, amazonError: null, marketError: null };
  }

  let marketInfo = null;
  let marketError = null;
  try {
    marketInfo = await getMarketReferencePrice(query);
  } catch (e) {
    marketError = e.message;
  }

  if (marketInfo) {
    return { refPrice: marketInfo.median, source: "leboncoin_median", info: marketInfo, amazonError, marketError: null };
  }

  return { refPrice: null, source: null, info: null, amazonError, marketError };
}

/**
 * Crée une nouvelle surveillance ET effectue immédiatement une recherche :
 * les annonces déjà existantes sont triées par prix croissant, les
 * `immediateLimit` moins chères sont postées tout de suite dans le salon
 * Discord (avec badge 🔥 si elles dépassent le seuil de bonne affaire),
 * et TOUTES les annonces trouvées sont marquées comme vues pour ne pas
 * être réalertées lors du prochain poll.
 */
export async function createWatch({
  query,
  maxPrice,
  zipcode,
  radiusKm,
  manualRefPrice,
  channelId,
  guildId,
  client,
  immediateLimit = 5,
}) {
  let lat = null;
  let lon = null;
  let geoWarning = null;

  if (zipcode) {
    try {
      const geo = await geocodeZipcode(zipcode);
      lat = geo.lat;
      lon = geo.lon;
    } catch (e) {
      geoWarning = `Géocodage du code postal "${zipcode}" impossible (${e.message}) — surveillance démarrée sans filtre géographique.`;
    }
  }

  const watch = {
    id: randomUUID().slice(0, 8),
    query,
    maxPrice: maxPrice ?? null,
    zipcode: lat != null ? zipcode : null,
    radiusKm: lat != null ? radiusKm ?? DEFAULT_RADIUS_KM : null,
    lat,
    lon,
    refPrice: manualRefPrice ?? null,
    refPriceManual: manualRefPrice != null,
    refPriceSource: manualRefPrice != null ? "manual" : null,
    refPriceUpdatedAt: manualRefPrice != null ? new Date().toISOString() : null,
    channelId,
    guildId,
    createdAt: new Date().toISOString(),
  };

  let refPriceInfo = null;
  let refPriceSourceUsed = null;
  let refPriceErrors = null;
  if (!watch.refPriceManual) {
    const result = await fetchReferencePrice(query);
    if (result.refPrice) {
      watch.refPrice = result.refPrice;
      watch.refPriceSource = result.source;
      watch.refPriceUpdatedAt = new Date().toISOString();
    }
    refPriceInfo = result.info;
    refPriceSourceUsed = result.source;
    refPriceErrors = { amazonError: result.amazonError, marketError: result.marketError };
  }

  const savedWatch = addWatch(watch);

  let results = [];
  let searchError = null;
  try {
    results = await searchLeboncoin(query, {
      maxPrice,
      lat,
      lon,
      radiusKm: savedWatch.radius_km,
    });
  } catch (e) {
    searchError = e.message;
    console.error("Recherche initiale Leboncoin échouée :", e.message);
  }

  // On priorise les moins chères pour la recherche immédiate.
  const sorted = [...results].sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
  );
  const toAlert = sorted.slice(0, immediateLimit);

  const alertedListings = [];
  if (toAlert.length > 0 && client) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      for (const listing of toAlert) {
        const { embed, isDeal } = buildEmbed(listing, savedWatch);
        await channel
          .send({ embeds: [embed] })
          .catch((e) => console.error("Erreur d'envoi :", e.message));
        alertedListings.push({ ...listing, isDeal });
        await sleep(1000);
      }
    }
  }

  // Toutes les annonces trouvées (alertées ou non) sont marquées vues, pour
  // que seules les VRAIES nouvelles annonces déclenchent une alerte ensuite.
  const allWithFlag = results.map((l) => {
    const already = alertedListings.find((a) => a.id === l.id);
    if (already) return already;
    const { isDeal } = buildEmbed(l, savedWatch);
    return { ...l, isDeal };
  });
  markSeen(savedWatch.id, allWithFlag);

  return {
    watch: savedWatch,
    geoWarning,
    refPriceInfo,
    refPriceSource: refPriceSourceUsed,
    refPriceErrors,
    searchError,
    totalFound: results.length,
    alertedCount: alertedListings.length,
    dealsFound: allWithFlag.filter((l) => l.isDeal).length,
  };
}

/**
 * Vérifie un watch existant lors d'un cycle de polling normal : alerte sur
 * TOUTES les annonces nouvelles depuis le dernier passage (pas de limite,
 * contrairement à createWatch, puisqu'il devrait normalement n'y en avoir
 * que très peu à chaque cycle).
 */
export async function runWatchCheck(watchRow, client) {
  const results = await searchLeboncoin(watchRow.query, {
    maxPrice: watchRow.max_price,
    lat: watchRow.lat,
    lon: watchRow.lon,
    radiusKm: watchRow.radius_km,
  });

  const freshIds = new Set(filterUnseen(watchRow.id, results.map((l) => l.id)));
  const fresh = results.filter((l) => freshIds.has(l.id));

  const sentListings = [];
  if (fresh.length > 0) {
    const channel = client
      ? await client.channels.fetch(watchRow.channel_id).catch(() => null)
      : null;

    for (const listing of fresh) {
      const { embed, isDeal } = buildEmbed(listing, watchRow);
      if (channel) {
        await channel
          .send({ embeds: [embed] })
          .catch((e) => console.error("Erreur d'envoi :", e.message));
        await sleep(1000);
      }
      sentListings.push({ ...listing, isDeal });
    }
  }

  markSeen(watchRow.id, sentListings);
  return { freshFound: fresh.length };
}
