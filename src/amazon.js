// src/amazon.js
// Récupère un prix de référence Amazon pour un mot-clé, afin de détecter
// les "bonnes affaires" sur Leboncoin.
//
// ATTENTION : c'est la source la plus fragile du projet. Amazon bloque très
// souvent les requêtes faites en dehors d'un vrai navigateur (filtrage au
// niveau TLS/réseau par leur WAF, avant même de renvoyer une réponse HTTP —
// c'est ce qui se manifeste par une erreur "fetch failed" plutôt qu'un code
// HTTP classique comme 403). Des headers plus complets aident un peu, mais
// il n'y a pas de solution fiable à 100% sans tomber dans des techniques de
// contournement plus lourdes que je ne veux pas pousser ici.
//
// Si ça continue à échouer chez toi : utilise `/watch ... prix_reference:<valeur>`
// pour fixer le prix de référence toi-même et désactiver l'auto-fetch sur ce watch.

import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "no-cache",
};

export async function searchAmazon(query, { maxResults = 10 } = {}) {
  const url = `https://www.amazon.fr/s?k=${encodeURIComponent(query)}`;

  let res;
  try {
    res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    // e.cause contient souvent le vrai code d'erreur reseau (ECONNRESET,
    // ETIMEDOUT, certificat invalide, etc.) que "fetch failed" seul ne montre pas.
    const causeInfo = e.cause ? ` — cause: ${e.cause.code || e.cause.message || e.cause}` : "";
    throw new Error(`Échec de connexion à Amazon (${e.message})${causeInfo}`);
  }

  if (!res.ok) {
    throw new Error(`Amazon a répondu ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];

  $("div[data-component-type='s-search-result']").each((_, el) => {
    if (results.length >= maxResults) return;
    const $el = $(el);

    const title = $el.find("h2 a span").first().text().trim();
    const href = $el.find("h2 a").first().attr("href");
    if (!title || !href) return;

    const priceWhole = $el.find(".a-price-whole").first();
    const priceFrac = $el.find(".a-price-fraction").first();

    let price = null;
    if (priceWhole.length) {
      const raw = priceWhole.text().trim().replace(/[\s\u00A0.,]/g, "");
      const frac = priceFrac.length ? priceFrac.text().trim() : "00";
      const parsed = parseFloat(`${raw}.${frac}`);
      if (!Number.isNaN(parsed)) price = parsed;
    }

    results.push({ title, price, url: `https://www.amazon.fr${href}` });
  });

  if (results.length === 0) {
    // Page renvoyée mais structure non reconnue (souvent : page de CAPTCHA
    // ou de vérification "robot" au lieu des vrais résultats de recherche).
    const looksLikeCaptcha = /captcha|robot check|api-services-support/i.test(html);
    if (looksLikeCaptcha) {
      throw new Error("Amazon a renvoyé une page de vérification anti-bot (captcha), pas de résultats exploitables");
    }
  }

  return results;
}

/**
 * Renvoie un résumé statistique des prix Amazon pour un mot-clé, ou null
 * si aucun prix n'a pu être extrait.
 */
export async function getReferencePrice(query, opts = {}) {
  const results = await searchAmazon(query, opts);
  const prices = results.map((r) => r.price).filter((p) => p !== null);
  if (prices.length === 0) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const average = prices.reduce((a, b) => a + b, 0) / prices.length;
  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    average,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    sampleSize: prices.length,
  };
}
