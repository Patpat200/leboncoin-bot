// src/db.js
// Persistance en SQLite (via better-sqlite3) : table des surveillances +
// table de l'historique des annonces déjà vues (avec métadonnées, pour
// pouvoir afficher un flux dans l'interface web).

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, "..", "storage");
mkdirSync(STORAGE_DIR, { recursive: true });

const db = new Database(path.join(STORAGE_DIR, "data.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS watches (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    max_price REAL,
    zipcode TEXT,
    radius_km REAL,
    lat REAL,
    lon REAL,
    ref_price REAL,
    ref_price_manual INTEGER NOT NULL DEFAULT 0,
    ref_price_updated_at TEXT,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seen_listings (
    watch_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    title TEXT,
    price REAL,
    url TEXT,
    image TEXT,
    location TEXT,
    is_deal INTEGER NOT NULL DEFAULT 0,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (watch_id, listing_id)
  );
`);

// Migration douce : ajoute la colonne ref_price_source si elle n'existe pas
// déjà (utile si tu mets à jour le bot sans repartir d'une base vide).
const existingCols = db.prepare("PRAGMA table_info(watches)").all().map((c) => c.name);
if (!existingCols.includes("ref_price_source")) {
  db.exec("ALTER TABLE watches ADD COLUMN ref_price_source TEXT");
}

export function addWatch(watch) {
  db.prepare(`
    INSERT INTO watches
      (id, query, max_price, zipcode, radius_km, lat, lon, ref_price,
       ref_price_manual, ref_price_source, ref_price_updated_at, channel_id, guild_id,
       paused, created_at)
    VALUES
      (@id, @query, @maxPrice, @zipcode, @radiusKm, @lat, @lon, @refPrice,
       @refPriceManual, @refPriceSource, @refPriceUpdatedAt, @channelId, @guildId,
       0, @createdAt)
  `).run({
    id: watch.id,
    query: watch.query,
    maxPrice: watch.maxPrice ?? null,
    zipcode: watch.zipcode ?? null,
    radiusKm: watch.radiusKm ?? null,
    lat: watch.lat ?? null,
    lon: watch.lon ?? null,
    refPrice: watch.refPrice ?? null,
    refPriceManual: watch.refPriceManual ? 1 : 0,
    refPriceSource: watch.refPriceSource ?? (watch.refPriceManual ? "manual" : null),
    refPriceUpdatedAt: watch.refPriceUpdatedAt ?? null,
    channelId: watch.channelId,
    guildId: watch.guildId,
    createdAt: watch.createdAt,
  });
  return getWatch(watch.id);
}

export function getWatch(id) {
  return db.prepare("SELECT * FROM watches WHERE id = ?").get(id);
}

export function listWatches({ guildId } = {}) {
  if (guildId) {
    return db
      .prepare("SELECT * FROM watches WHERE guild_id = ? ORDER BY created_at")
      .all(guildId);
  }
  return db.prepare("SELECT * FROM watches ORDER BY created_at").all();
}

export function removeWatch(id) {
  db.prepare("DELETE FROM seen_listings WHERE watch_id = ?").run(id);
  const res = db.prepare("DELETE FROM watches WHERE id = ?").run(id);
  return res.changes > 0;
}

export function setPaused(id, paused) {
  const res = db
    .prepare("UPDATE watches SET paused = ? WHERE id = ?")
    .run(paused ? 1 : 0, id);
  return res.changes > 0;
}

export function updateRefPrice(id, refPrice, source = null) {
  db.prepare(
    "UPDATE watches SET ref_price = ?, ref_price_source = ?, ref_price_updated_at = ? WHERE id = ?"
  ).run(refPrice, source, new Date().toISOString(), id);
}

/** Renvoie, parmi listingIds, ceux qui n'ont pas encore été vus pour ce watch. */
export function filterUnseen(watchId, listingIds) {
  if (listingIds.length === 0) return [];
  const stmt = db.prepare(
    "SELECT 1 FROM seen_listings WHERE watch_id = ? AND listing_id = ?"
  );
  return listingIds.filter((id) => !stmt.get(watchId, id));
}

/**
 * Enregistre des annonces comme "vues" (avec leurs métadonnées, pour le
 * flux de l'interface web). `listings` : tableau d'objets
 * {id, title, price, url, image, location, isDeal}.
 */
export function markSeen(watchId, listings) {
  if (!listings || listings.length === 0) return;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO seen_listings
      (watch_id, listing_id, title, price, url, image, location, is_deal, seen_at)
    VALUES (@watchId, @listingId, @title, @price, @url, @image, @location, @isDeal, @seenAt)
  `);
  const now = new Date().toISOString();
  const tx = db.transaction((items) => {
    for (const l of items) {
      stmt.run({
        watchId,
        listingId: l.id,
        title: l.title ?? null,
        price: l.price ?? null,
        url: l.url ?? null,
        image: l.image ?? null,
        location: l.location ?? null,
        isDeal: l.isDeal ? 1 : 0,
        seenAt: now,
      });
    }
  });
  tx(listings);
}

/**
 * Flux des annonces déjà postées, le plus récent en premier.
 * Filtres optionnels : watchId, guildId, onlyDeals.
 */
export function getRecentListings({ watchId, guildId, onlyDeals } = {}, limit = 100) {
  let sql = `
    SELECT sl.*, w.query AS watch_query, w.guild_id, w.channel_id
    FROM seen_listings sl
    JOIN watches w ON w.id = sl.watch_id
  `;
  const clauses = [];
  const params = { limit };
  if (watchId) {
    clauses.push("sl.watch_id = @watchId");
    params.watchId = watchId;
  }
  if (guildId) {
    clauses.push("w.guild_id = @guildId");
    params.guildId = guildId;
  }
  if (onlyDeals) {
    clauses.push("sl.is_deal = 1");
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY sl.seen_at DESC LIMIT @limit";
  return db.prepare(sql).all(params);
}

export default db;
