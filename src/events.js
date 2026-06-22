// src/events.js
// EventEmitter partagé : le bot (watchService, commandes Discord) émet des
// événements ici, le serveur web (web.js) les relaie en WebSocket à tous les
// navigateurs connectés au dashboard. Découple complètement la logique
// métier de la couche web.

import { EventEmitter } from "events";

export const botEvents = new EventEmitter();

// Beaucoup de watches peuvent être créés/modifiés rapidement (ex: scan
// initial d'un /watch qui marque 30+ annonces vues), on évite le warning
// "MaxListenersExceededWarning" par precaution.
botEvents.setMaxListeners(50);
