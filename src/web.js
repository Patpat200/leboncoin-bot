// src/web.js
// Dashboard web avec mises à jour en temps réel via WebSocket (Socket.IO).
//
// ⚠️ SÉCURITÉ : ce serveur n'a AUCUNE authentification. Prévu pour un usage
// local uniquement. Ne l'expose pas sur internet sans ajouter au moins un
// mot de passe devant.

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import {
  listWatches,
  getWatch,
  removeWatch,
  setPaused,
  getRecentListings,
} from "./db.js";
import { createWatch } from "./watchService.js";
import { botEvents } from "./events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWebServer(client) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));

  // ---------------------------------------------------------------------
  // Routes REST (état initial au chargement de la page + actions)
  // ---------------------------------------------------------------------
  app.get("/api/guilds", (req, res) => {
    const guilds = client.guilds.cache.map((g) => ({
      id: g.id,
      name: g.name,
      channels: g.channels.cache
        .filter((c) => c.isTextBased && c.isTextBased() && !c.isThread?.())
        .map((c) => ({ id: c.id, name: c.name })),
    }));
    res.json(guilds);
  });

  app.get("/api/watches", (req, res) => {
    res.json(listWatches());
  });

  app.post("/api/watches", async (req, res) => {
    const { query, maxPrice, zipcode, radiusKm, refPrice, guildId, channelId } =
      req.body || {};

    if (!query || !guildId || !channelId) {
      return res
        .status(400)
        .json({ error: "query, guildId et channelId sont requis." });
    }

    try {
      // createWatch émet déjà watch:created et listing:new (voir watchService.js)
      // -> les clients connectés sont mis à jour automatiquement.
      const result = await createWatch({
        query,
        maxPrice: maxPrice || null,
        zipcode: zipcode || null,
        radiusKm: radiusKm || null,
        manualRefPrice: refPrice || null,
        channelId,
        guildId,
        client,
      });
      res.json(result);
    } catch (e) {
      console.error("Erreur création watch (web) :", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/watches/:id/pause", (req, res) => {
    const ok = setPaused(req.params.id, true);
    if (ok) botEvents.emit("watch:updated", getWatch(req.params.id));
    res.json({ ok });
  });

  app.post("/api/watches/:id/resume", (req, res) => {
    const ok = setPaused(req.params.id, false);
    if (ok) botEvents.emit("watch:updated", getWatch(req.params.id));
    res.json({ ok });
  });

  app.delete("/api/watches/:id", (req, res) => {
    const ok = removeWatch(req.params.id);
    if (ok) botEvents.emit("watch:deleted", { id: req.params.id });
    res.json({ ok });
  });

  app.get("/api/listings", (req, res) => {
    const { watchId, onlyDeals } = req.query;
    const listings = getRecentListings(
      { watchId: watchId || undefined, onlyDeals: onlyDeals === "true" },
      150
    );
    res.json(listings);
  });

  // ---------------------------------------------------------------------
  // Socket.IO : relaie les événements du bot vers tous les navigateurs
  // connectés. Le client Socket.IO est servi automatiquement par le
  // package sur /socket.io/socket.io.js, pas besoin de CDN.
  // ---------------------------------------------------------------------
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer);

  const forward = (event) => (payload) => io.emit(event, payload);
  botEvents.on("watch:created", forward("watch:created"));
  botEvents.on("watch:updated", forward("watch:updated"));
  botEvents.on("watch:deleted", forward("watch:deleted"));
  botEvents.on("listing:new", forward("listing:new"));

  io.on("connection", (socket) => {
    console.log(`[web] client connecté (${socket.id})`);
    socket.on("disconnect", () => {
      console.log(`[web] client déconnecté (${socket.id})`);
    });
  });

  const port = Number(process.env.WEB_PORT) || 3000;
  httpServer.listen(port, () => {
    console.log(`Interface web (temps réel) disponible sur http://localhost:${port}`);
  });

  return io;
}
