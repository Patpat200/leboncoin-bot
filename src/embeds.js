// src/embeds.js
import { EmbedBuilder } from "discord.js";

export const DEAL_THRESHOLD =
  (Number(process.env.DEAL_THRESHOLD_PERCENT) || 25) / 100;

const SOURCE_LABELS = {
  manual: "manuelle",
  amazon: "Amazon",
  leboncoin_median: "médiane marché Leboncoin",
};

/**
 * Construit l'embed Discord pour une annonce, et calcule si c'est une
 * "bonne affaire" par rapport au prix de référence du watch (s'il existe).
 * @returns {{embed: EmbedBuilder, isDeal: boolean}}
 */
export function buildEmbed(listing, watch) {
  const descLines = [];

  descLines.push(
    listing.price !== null && listing.price !== undefined
      ? `**${listing.price} €**`
      : "Prix non précisé"
  );
  if (listing.location) descLines.push(`📍 ${listing.location}`);

  let isDeal = false;
  if (watch.ref_price && listing.price !== null && listing.price !== undefined) {
    const discount = (watch.ref_price - listing.price) / watch.ref_price;
    const pct = Math.round(discount * 100);
    const sourceLabel = SOURCE_LABELS[watch.ref_price_source] || "référence";
    descLines.push(
      `Réf. ${sourceLabel} : ~${Math.round(watch.ref_price)}€ (${
        pct >= 0 ? "-" : "+"
      }${Math.abs(pct)}%)`
    );
    if (discount >= DEAL_THRESHOLD) isDeal = true;
  }

  const title =
    (isDeal ? "🔥 BONNE AFFAIRE — " : "") + (listing.title || "(sans titre)");

  const embed = new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setURL(listing.url)
    .setDescription(descLines.join("\n"))
    .setColor(isDeal ? 0x57f287 : 0xec5b2f)
    .setFooter({ text: `Recherche : ${watch.query}` })
    .setTimestamp();

  if (listing.image) embed.setImage(listing.image);

  return { embed, isDeal };
}
