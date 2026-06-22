// src/index.js
import { Client, GatewayIntentBits, MessageFlags } from "discord.js";
import dotenv from "dotenv";
import {
  getWatch,
  listWatches,
  removeWatch,
  setPaused,
  updateRefPrice,
} from "./db.js";
import { createWatch, runWatchCheck, fetchReferencePrice } from "./watchService.js";
import { DEAL_THRESHOLD } from "./embeds.js";
import { startWebServer } from "./web.js";

dotenv.config();

const POLL_INTERVAL_MS =
  (Number(process.env.POLL_INTERVAL_MINUTES) || 5) * 60 * 1000;
const REF_PRICE_REFRESH_MS =
  (Number(process.env.REF_PRICE_REFRESH_HOURS) || 24) * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------------------------------------------------------------------------
// Aide
// ---------------------------------------------------------------------------
const HELP_TEXT = [
  "**Commandes disponibles**",
  "",
  "`/watch recherche:<mot-clé> [prix_max] [code_postal] [rayon_km] [prix_reference]`",
  "→ démarre une surveillance dans le salon courant ET poste tout de suite",
  "  les annonces actuelles les moins chères (jusqu'à 5).",
  "  • `prix_max` : ignore les annonces plus chères",
  "  • `code_postal` + `rayon_km` : filtre géographique (rayon par défaut 20km)",
  "  • `prix_reference` : prix de référence fixe en € (sinon auto : Amazon, puis",
  "    repli sur la médiane des annonces Leboncoin si Amazon est indisponible)",
  "",
  "`/list` — liste les surveillances actives sur ce serveur",
  "`/pause id:<id>` — met en pause une surveillance",
  "`/resume id:<id>` — réactive une surveillance",
  "`/unwatch id:<id>` — supprime définitivement une surveillance",
  "`/help` — affiche ce message",
  "",
  "💡 Les annonces nettement sous le prix de référence Amazon",
  `(seuil actuel : -${Math.round(DEAL_THRESHOLD * 100)}%) sont marquées 🔥.`,
  "",
  `🖥️ Interface web : http://localhost:${process.env.WEB_PORT || 3000}`,
].join("\n");

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "help": {
        await interaction.reply({
          content: HELP_TEXT,
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "watch": {
        await handleWatch(interaction);
        break;
      }

      case "unwatch": {
        const id = interaction.options.getString("id", true);
        const watch = getWatch(id);
        if (!watch || watch.guild_id !== interaction.guildId) {
          await interaction.reply({
            content: `Aucune surveillance trouvée avec l'ID \`${id}\` sur ce serveur.`,
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        removeWatch(id);
        await interaction.reply({
          content: `Surveillance \`${id}\` (${watch.query}) supprimée.`,
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "pause":
      case "resume": {
        const id = interaction.options.getString("id", true);
        const watch = getWatch(id);
        if (!watch || watch.guild_id !== interaction.guildId) {
          await interaction.reply({
            content: `Aucune surveillance trouvée avec l'ID \`${id}\` sur ce serveur.`,
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const pausing = interaction.commandName === "pause";
        setPaused(id, pausing);
        await interaction.reply({
          content: `Surveillance \`${id}\` (${watch.query}) ${
            pausing ? "mise en pause ⏸️" : "réactivée ▶️"
          }.`,
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "list": {
        const watches = listWatches({ guildId: interaction.guildId });
        if (watches.length === 0) {
          await interaction.reply({
            content: "Aucune surveillance active sur ce serveur.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const lines = watches.map((w) => {
          const parts = [`\`${w.id}\` — **${w.query}**`];
          if (w.max_price) parts.push(`max ${w.max_price}€`);
          if (w.zipcode) parts.push(`📍 ${w.zipcode} (${w.radius_km}km)`);
          if (w.ref_price) {
            const src = w.ref_price_source === "amazon" ? "Amz" : w.ref_price_source === "leboncoin_median" ? "LBC" : "manuel";
            parts.push(`réf. ${Math.round(w.ref_price)}€ (${src})`);
          }
          parts.push(w.paused ? "⏸️ en pause" : "▶️ actif");
          parts.push(`<#${w.channel_id}>`);
          return parts.join(" — ");
        });
        await interaction.reply({
          content: "**Surveillances :**\n" + lines.join("\n"),
          flags: MessageFlags.Ephemeral,
        });
        break;
      }
    }
  } catch (err) {
    console.error("Erreur sur la commande :", err);
    if (interaction.isRepliable()) {
      await interaction
        .reply({ content: "Une erreur est survenue.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

async function handleWatch(interaction) {
  const query = interaction.options.getString("recherche", true);
  const maxPrice = interaction.options.getNumber("prix_max") ?? null;
  const zipcode = interaction.options.getString("code_postal") ?? null;
  const radiusKm = interaction.options.getNumber("rayon_km") ?? null;
  const manualRefPrice = interaction.options.getNumber("prix_reference") ?? null;

  await interaction.deferReply();

  const result = await createWatch({
    query,
    maxPrice,
    zipcode,
    radiusKm,
    manualRefPrice,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    client,
  });

  const lines = [`Surveillance activée (\`${result.watch.id}\`) pour **${query}**.`];

  if (maxPrice) lines.push(`Prix max : ${maxPrice}€`);
  if (result.watch.zipcode)
    lines.push(`Zone : ${result.watch.zipcode}, rayon ${result.watch.radius_km}km`);

  if (manualRefPrice) {
    lines.push(`Prix de référence fixé manuellement : ${manualRefPrice}€`);
  } else if (result.refPriceInfo && result.refPriceSource === "amazon") {
    lines.push(
      `Prix de référence Amazon (auto) : ~${Math.round(
        result.refPriceInfo.average
      )}€ (sur ${result.refPriceInfo.sampleSize} annonces)`
    );
  } else if (result.refPriceInfo && result.refPriceSource === "leboncoin_median") {
    lines.push(
      `Amazon indisponible (${result.refPriceErrors?.amazonError || "bloqué"}) → ` +
        `prix de référence basé sur la médiane des annonces Leboncoin actuelles : ` +
        `~${Math.round(result.refPriceInfo.median)}€ (sur ${result.refPriceInfo.sampleSize} annonces)`
    );
  } else {
    lines.push(
      `⚠️ Aucun prix de référence disponible (Amazon : ${
        result.refPriceErrors?.amazonError || "échec"
      } / marché Leboncoin : ${
        result.refPriceErrors?.marketError || "échantillon insuffisant"
      }) — utilise \`prix_reference:\` pour en fixer un toi-même.`
    );
  }

  if (result.geoWarning) lines.push(`⚠️ ${result.geoWarning}`);
  if (result.searchError) lines.push(`⚠️ Recherche Leboncoin échouée : ${result.searchError}`);

  lines.push(
    `\n🔎 ${result.totalFound} annonce(s) trouvée(s) actuellement, ${result.alertedCount} postée(s) immédiatement ci-dessous` +
      (result.dealsFound ? ` (${result.dealsFound} en 🔥 bonne affaire)` : "") +
      "."
  );

  await interaction.editReply({ content: lines.join("\n") });
}

// ---------------------------------------------------------------------------
// Boucle de polling
// ---------------------------------------------------------------------------
async function pollOnce() {
  const watches = listWatches();

  for (const watchRow of watches) {
    if (watchRow.paused) continue;

    try {
      if (!watchRow.ref_price_manual) {
        const stale =
          !watchRow.ref_price_updated_at ||
          Date.now() - new Date(watchRow.ref_price_updated_at).getTime() >
            REF_PRICE_REFRESH_MS;

        if (stale) {
          try {
            const result = await fetchReferencePrice(watchRow.query);
            if (result.refPrice) {
              updateRefPrice(watchRow.id, result.refPrice, result.source);
              watchRow.ref_price = result.refPrice;
              watchRow.ref_price_source = result.source;
            }
          } catch (e) {
            console.error(
              `Refresh prix de référence échoué pour "${watchRow.query}" :`,
              e.message
            );
          }
          await sleep(2000);
        }
      }

      const { freshFound } = await runWatchCheck(watchRow, client);
      if (freshFound > 0) {
        console.log(`[poll] ${freshFound} nouvelle(s) annonce(s) pour "${watchRow.query}"`);
      }
    } catch (err) {
      console.error(`Erreur lors du polling de "${watchRow.query}" :`, err.message);
    }

    await sleep(2000); // pause entre chaque watch, courtoisie envers l'API
  }
}

client.once("clientReady", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  console.log(`Polling toutes les ${POLL_INTERVAL_MS / 60000} minutes.`);
  startWebServer(client);
  pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
});

client.login(process.env.DISCORD_TOKEN);
