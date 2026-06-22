// src/leboncoin.js
// Recherche d'annonces via l'API interne de Leboncoin.
// ATTENTION : endpoint non officiel, protégé par DataDome. Peut casser ou
// se faire bloquer (403/429) sans prévenir. Si ça arrive, récupère un cookie
// valide via ton navigateur et mets-le dans LBC_COOKIE (.env).

const BASE_URL = "https://api.leboncoin.fr/finder/search";

const HEADERS_BASE = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "Content-Type": "application/json",
};

/**
 * Cherche des annonces Leboncoin pour un mot-clé donné.
 * @param {string} query
 * @param {object} opts
 * @param {number} [opts.maxPrice]
 * @param {number} [opts.lat] - latitude pour filtre géographique
 * @param {number} [opts.lon] - longitude pour filtre géographique
 * @param {number} [opts.radiusKm] - rayon en km (défaut 20 si lat/lon fournis)
 * @param {number} [opts.limit]
 */
export async function searchLeboncoin(query, opts = {}) {
  const { maxPrice, lat, lon, radiusKm, limit = 35 } = opts;

  const filters = {
    category: {},
    enums: {},
    keywords: { text: query },
  };

  if (maxPrice) {
    filters.range = { price: { max: maxPrice } };
  }

  // NB : format du filtre géographique reconstitué d'après des projets de
  // scraping communautaires, non vérifié en direct ici (pas d'accès réseau
  // à leboncoin.fr dans cet environnement). Si le filtre ne semble pas
  // appliqué, inspecte une requête "finder/search" avec localisation activée
  // depuis les devtools du navigateur pour corriger ce bloc.
  if (lat != null && lon != null) {
    filters.location = {
      area: {
        lat,
        lng: lon,
        radius: (radiusKm ?? 20) * 1000, // en mètres
      },
    };
  }

  const payload = {
    filters,
    limit,
    limit_alu: 3,
    offset: 0,
    sort_by: "time",
    sort_order: "desc",
  };

  const headers = { ...HEADERS_BASE };
  if (process.env.LBC_COOKIE) {
    headers["Cookie"] = process.env.LBC_COOKIE;
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Leboncoin a répondu ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const ads = data.ads || [];

  return ads.map((ad) => {
    const priceArr = ad.price || [];
    const images = (ad.images && ad.images.urls) || [];
    return {
      id: String(ad.list_id ?? ad.id ?? ad.url),
      title: ad.subject || "(sans titre)",
      price: typeof priceArr[0] === "number" ? priceArr[0] : null,
      url: ad.url || "",
      image: images[0] || null,
      location:
        (ad.location && (ad.location.city || ad.location.label)) || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Prix de référence basé sur le marché Leboncoin lui-même : médiane des
// annonces actuelles pour la même recherche, après filtrage des valeurs
// extrêmes (méthode IQR). Avantage par rapport à une source externe (Amazon,
// etc.) : aucune dépendance réseau supplémentaire, toujours disponible
// puisqu'on interroge déjà Leboncoin, et compare de l'occasion à de
// l'occasion (plus pertinent que comparer à un prix neuf).
//
// Limite à connaître : si la recherche est trop large (ex: "iphone" au lieu
// de "iphone 12 64go"), l'échantillon mélange des produits différents et la
// médiane perd en pertinence. Plus la recherche est précise, plus c'est fiable.
// ---------------------------------------------------------------------------

function median(sortedArr) {
  const mid = Math.floor(sortedArr.length / 2);
  return sortedArr.length % 2 !== 0
    ? sortedArr[mid]
    : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

function quartile(sortedArr, q) {
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedArr[base + 1] !== undefined
    ? sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
    : sortedArr[base];
}

function removeOutliersIQR(sortedArr) {
  if (sortedArr.length < 4) return sortedArr; // échantillon trop petit pour un IQR fiable
  const q1 = quartile(sortedArr, 0.25);
  const q3 = quartile(sortedArr, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return sortedArr.filter((v) => v >= lower && v <= upper);
}

/**
 * Calcule une référence de prix à partir des annonces Leboncoin actuelles
 * pour ce mot-clé. Renvoie null si l'échantillon est trop petit (< 3 prix
 * exploitables) pour être statistiquement fiable.
 */
export async function getMarketReferencePrice(query, { sampleSize = 50 } = {}) {
  const results = await searchLeboncoin(query, { limit: sampleSize });
  const prices = results.map((r) => r.price).filter((p) => p != null && p > 0);

  if (prices.length < 3) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const cleaned = removeOutliersIQR(sorted);

  return {
    median: median(cleaned),
    average: cleaned.reduce((a, b) => a + b, 0) / cleaned.length,
    min: cleaned[0],
    max: cleaned[cleaned.length - 1],
    sampleSize: cleaned.length,
    rawSampleSize: prices.length,
  };
}
