# Bot Discord — Veille Leboncoin v2 (usage éducatif/personnel)

Bot qui surveille des recherches Leboncoin et poste une alerte Discord
(embed avec photo, prix, lien) à chaque nouvelle annonce correspondante.
Filtre géographique, comparaison automatique avec un prix de référence
Amazon pour repérer les bonnes affaires, persistance SQLite, pause/reprise
par surveillance.

⚠️ **Avant tout** : ceci scrape des API non officielles (Leboncoin, Amazon),
en dehors de leurs CGU respectives. Reste raisonnable sur la fréquence de
polling pour ne pas te faire bloquer ni saturer leurs serveurs.

## Nouveautés v5 — dashboard en temps réel (WebSocket)

Le dashboard ne fait plus de polling toutes les 15s : il utilise Socket.IO
pour recevoir les mises à jour en direct, dès qu'elles se produisent côté
bot (création de watch, nouvelle annonce trouvée, pause/reprise,
suppression) — que l'action vienne de Discord ou du dashboard lui-même.

Architecture : `src/events.js` expose un `EventEmitter` partagé. Le bot
(`watchService.js`, commandes Discord dans `index.js`) émet des événements
dessus ; `web.js` les relaie en WebSocket à tous les onglets ouverts sur le
dashboard. Si tu ouvres le dashboard sur deux appareils en même temps, les
deux se mettent à jour en même temps.

Un petit indicateur en haut à droite (🟢/🔴) montre l'état de la connexion
WebSocket — utile pour savoir si le serveur a redémarré ou si ta connexion
a un problème.

## Nouveautés v4 — prix de référence avec repli automatique

Amazon bloque très souvent les requêtes directes (`ECONNRESET` = leur
protection coupe la connexion avant même de répondre — pas réparable avec
des headers, c'est au niveau réseau/TLS). Plutôt que de s'acharner contre
ça, le bot a maintenant une **référence de repli qui ne dépend d'aucune
source externe** :

1. **Amazon** est toujours tenté en premier (best effort).
2. S'il échoue → repli sur la **médiane des annonces Leboncoin actuelles**
   pour la même recherche, avec filtrage des valeurs extrêmes (méthode IQR,
   pour ignorer les annonces à 1€ ou les coques mal catégorisées qui
   fausseraient la moyenne).

Cette deuxième approche a un avantage qui dépasse le simple "ça marche
toujours" : elle compare de l'occasion à de l'occasion (le prix médian
réel du marché Leboncoin), ce qui est souvent plus pertinent pour détecter
une vraie bonne affaire que de comparer au prix du neuf sur Amazon.

⚠️ Limite à connaître : si ta recherche est trop large (ex: "iphone" plutôt
que "iphone 12 64go"), l'échantillon mélange des produits différents
(modèles, états, accessoires) et la médiane perd en pertinence. Plus la
recherche est précise, plus la référence est fiable.

La source utilisée (`Amazon` / `médiane LBC` / `manuel`) est affichée dans
`/list`, dans le dashboard web, et dans chaque embed d'alerte.

## Nouveautés v3

- 🖥️ **Interface web locale** : http://localhost:3000 une fois le bot lancé.
  Créer/pauser/reprendre/supprimer des surveillances sans passer par Discord,
  et voir un flux de toutes les annonces déjà repérées (avec badge 🔥 pour
  les bonnes affaires). Se rafraîchit automatiquement toutes les 15s.
- ⚡ **Recherche immédiate au `/watch`** : avant, la création d'une
  surveillance se contentait de mémoriser les annonces existantes en
  silence. Maintenant, elle poste tout de suite les annonces actuelles les
  moins chères (jusqu'à 5), avec le badge 🔥 si elles sont déjà sous le
  seuil de bonne affaire — tu n'attends plus le prochain cycle de polling
  pour voir ce qui existe déjà.
- 🩺 Erreurs Amazon plus explicites (cause réseau visible dans les logs)
  et headers de requête plus complets.
- Correction des deux warnings discord.js (`ready` → `clientReady`,
  `ephemeral` → `flags: MessageFlags.Ephemeral`).

⚠️ **Sécurité de l'interface web** : aucune authentification. Prévue pour un
usage strictement local. Ne l'expose pas sur internet sans ajouter au moins
un mot de passe devant (n'importe qui y accédant pourrait créer des
surveillances ou supprimer les tiennes).

## Nouveautés v2

- 📍 **Filtre géographique** : `/watch ... code_postal:68000 rayon_km:15`
  (géocodage via l'API Adresse du gouvernement, gratuite et fiable)
- 💰 **Détection de bonnes affaires** : le bot récupère automatiquement un
  prix moyen Amazon pour ta recherche, et marque 🔥 toute annonce Leboncoin
  nettement moins chère (seuil configurable, `DEAL_THRESHOLD_PERCENT`).
  Tu peux aussi fixer un prix de référence toi-même avec `prix_reference:`.
- 🗄️ **SQLite** au lieu du JSON brut — plus robuste si tu as beaucoup de
  surveillances actives.
- ⏸️ **`/pause` et `/resume`** par surveillance, sans avoir à la supprimer.
- ❓ **`/help`**

## 1. Créer le bot Discord

1. https://discord.com/developers/applications → **New Application**
2. Onglet **Bot** → **Reset Token** → copie le token (→ `DISCORD_TOKEN`)
3. Onglet **General Information** → copie l'**Application ID** (→ `CLIENT_ID`)
4. Onglet **OAuth2 > URL Generator** → coche `bot` + `applications.commands`,
   permissions `Send Messages` + `Embed Links` → ouvre l'URL générée pour
   inviter le bot sur ton serveur
5. Mode développeur Discord activé (Paramètres > Avancé) → clic droit sur
   ton serveur → **Copier l'ID** (→ `GUILD_ID`)

## 2. Installer

```bash
npm install
cp .env.example .env
# remplis .env (DISCORD_TOKEN, CLIENT_ID, GUILD_ID, etc.)
```

> Note sur `better-sqlite3` : ce package contient du code natif compilé,
> mais publie des binaires précompilés pour Windows/Mac/Linux courants
> (téléchargés depuis GitHub releases), donc `npm install` se contente
> normalement de télécharger le bon binaire sans rien compiler.
>
> Si malgré tout l'installation échoue avec une erreur de compilation
> (`node-gyp`, `Python`, etc. dans le message), il faudra installer les
> "Build Tools for Visual Studio" (workload "Desktop development with C++")
> sur Windows, ou `python3`/`make`/`g++` sur Linux — dis-le moi si tu tombes
> sur ce cas, on trouvera une alternative (par ex. `node:sqlite`, intégré
> nativement à partir de Node 22.5, ou repasser sur un stockage JSON).

## 3. Déployer les commandes slash

```bash
npm run deploy
```

## 4. Lancer le bot

```bash
npm start
```

Le dashboard web démarre automatiquement avec le bot, sur
http://localhost:3000 (configurable via `WEB_PORT` dans `.env`).

## Commandes

| Commande | Description |
|---|---|
| `/watch recherche:<mot-clé> [prix_max] [code_postal] [rayon_km] [prix_reference]` | Démarre une surveillance dans le salon courant |
| `/list` | Liste les surveillances actives sur le serveur |
| `/pause id:<id>` | Met en pause une surveillance |
| `/resume id:<id>` | Réactive une surveillance |
| `/unwatch id:<id>` | Supprime définitivement une surveillance |
| `/help` | Affiche l'aide |

**Exemple complet :**
```
/watch recherche:"iphone 12 64go" prix_max:250 code_postal:68000 rayon_km:30
```
→ alerte uniquement pour les iPhone 12 64Go à moins de 250€, dans un rayon
de 30km autour de Colmar, avec comparaison automatique au prix moyen Amazon.

## Si Leboncoin bloque les requêtes (403/429)

C'est DataDome. Solution la plus simple :
1. Ouvre Leboncoin dans ton navigateur, fais une recherche
2. Devtools (F12) → **Network** → filtre `finder/search` → clique sur la
   requête → **Headers** → copie la valeur de `Cookie`
3. Colle-la dans `.env` → `LBC_COOKIE=...`
4. Relance le bot

Ce cookie expire de temps en temps, il faudra le renouveler.

## Si Amazon bloque (prix de référence non récupéré)

Pas de solution propre sans tomber dans des techniques d'évasion plus
lourdes. Dans ce cas, utilise simplement `prix_reference:<valeur>` au moment
du `/watch` pour fixer un prix de référence toi-même — le bot n'essaiera
alors plus de l'auto-rafraîchir via Amazon pour ce watch.

## Limites connues / pistes d'amélioration

- Le filtre géographique Leboncoin (`filters.location.area`) est reconstitué
  d'après des projets de scraping communautaires et n'a pas pu être testé
  en conditions réelles dans l'environnement où ce bot a été écrit. Si le
  filtre ne semble pas s'appliquer, inspecte une requête `finder/search`
  avec localisation activée dans les devtools pour corriger `src/leboncoin.js`.
- Idem pour l'API de géocodage (`src/geocode.js`) : non testée en direct ici.
- Vinted n'est pas couvert par cette v2 (uniquement Leboncoin + référence
  Amazon) — possible à ajouter sur le même modèle si besoin.
