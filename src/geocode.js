// src/geocode.js
// Convertit un code postal en lat/lon via l'API Adresse du gouvernement
// français (api-adresse.data.gouv.fr) : API publique, gratuite, sans clé,
// pas de soucis d'anti-bot contrairement aux 3 plateformes scrapées.
//
// NB : non testé en conditions réelles dans cet environnement (pas d'accès
// réseau sortant vers ce domaine ici) — si le format de réponse a changé,
// adapte le parsing ci-dessous.

const cache = new Map();

export async function geocodeZipcode(zipcode) {
  if (cache.has(zipcode)) return cache.get(zipcode);

  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(
    zipcode
  )}&type=municipality&limit=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Géocodage échoué (${res.status})`);
  }

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) {
    throw new Error(`Code postal "${zipcode}" introuvable`);
  }

  const [lon, lat] = feature.geometry.coordinates;
  const result = { lat, lon, label: feature.properties?.label };
  cache.set(zipcode, result);
  return result;
}
