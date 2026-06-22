// src/deploy-commands.js
// A lancer une fois (ou après modif des commandes) avec : npm run deploy

import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Surveiller une recherche Leboncoin")
    .addStringOption((opt) =>
      opt
        .setName("recherche")
        .setDescription("Mot-clé à rechercher (ex: iphone 12 64go)")
        .setRequired(true)
    )
    .addNumberOption((opt) =>
      opt
        .setName("prix_max")
        .setDescription("Prix maximum en euros (optionnel)")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("code_postal")
        .setDescription("Code postal pour filtrer par zone (ex: 68000)")
        .setRequired(false)
    )
    .addNumberOption((opt) =>
      opt
        .setName("rayon_km")
        .setDescription("Rayon de recherche en km autour du code postal (défaut 20)")
        .setRequired(false)
    )
    .addNumberOption((opt) =>
      opt
        .setName("prix_reference")
        .setDescription(
          "Prix de référence fixe en € pour détecter les bonnes affaires (sinon auto via Amazon)"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unwatch")
    .setDescription("Supprimer définitivement une surveillance")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("ID de la surveillance (voir /list)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Mettre en pause une surveillance")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("ID de la surveillance (voir /list)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Réactiver une surveillance en pause")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("ID de la surveillance (voir /list)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("list")
    .setDescription("Lister les surveillances sur ce serveur"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Afficher l'aide du bot"),
].map((cmd) => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Déploiement des slash commands...");
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("Commandes déployées avec succès.");
} catch (err) {
  console.error("Erreur lors du déploiement :", err);
}
