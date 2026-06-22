// src/web.js
// Petit dashboard web pour gérer les surveillances sans passer par Discord,
// et visualiser le flux des annonces trouvées.
//
// ⚠️ SÉCURITÉ : ce serveur n'a AUCUNE authentification. Il est prévu pour
// un usage local (localhost) uniquement. Ne l'expose pas directement sur
// internet (port forwarding, reverse proxy public, etc.) sans ajouter au
// moins un mot de passe devant — n'importe qui qui y accède peut créer/
// supprimer des surveillances et faire poster le bot dans tes salons.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  listWatches,
  removeWatch,
  setPaused,
  getRecentListings,
} from "./db.js";
import { createWatch } from "./watchService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWebServer(client) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Liste des serveurs/salons où le bot est présent, pour le formulaire
  // de création de watch côté web.
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
    res.json({ ok: setPaused(req.params.id, true) });
  });

  app.post("/api/watches/:id/resume", (req, res) => {
    res.json({ ok: setPaused(req.params.id, false) });
  });

  app.delete("/api/watches/:id", (req, res) => {
    res.json({ ok: removeWatch(req.params.id) });
  });

  app.get("/api/listings", (req, res) => {
    const { watchId, onlyDeals } = req.query;
    const listings = getRecentListings(
      { watchId: watchId || undefined, onlyDeals: onlyDeals === "true" },
      150
    );
    res.json(listings);
  });

  const port = Number(process.env.WEB_PORT) || 3000;
  app.listen(port, () => {
    console.log(`Interface web disponible sur http://localhost:${port}`);
  });
}
