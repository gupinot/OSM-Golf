# Décisions techniques — OSM Golf Explorer

---

## 2026-04-21 — Architecture générale

**Choix :** Application web avec backend Express (JS) + frontend React + Vite (JS).

**Raison :** Exploration UI incrémentale ; pas de TypeScript pour l'instant pour aller vite. Express choisi pour sa simplicité. Vite pour le DX React.

---

## 2026-04-21 — Modes de recherche

**Choix :** Deux modes de recherche :
1. Par nom — requête Overpass `name~"…",i`
2. Par zone — ville (géocodée via Nominatim) ou géolocalisation navigateur + rayon paramétrable (5–100 km)

**Raison :** Couvre les cas d'usage principaux : chercher un golf précis par nom, ou explorer tous les golfs autour d'une position.

---

## 2026-04-21 — Architecture backend

**Choix :** Proxy Overpass + logique qualité côté backend Express. Routes : `GET /api/search/name`, `GET /api/search/zone`, `GET /api/holes`.

**Raison :** Évite les problèmes CORS avec Overpass depuis le navigateur. Centralise la logique de qualité (portée du script Python `analyze_osm_cgolf.py`).

---

## 2026-04-21 — Affichage des trous (incrément 1)

**Choix :** Tableau tabulaire sans carte. Colonnes : ref, par, hcp, distances par couleur (ordre : black > white > yellow > blue > red > gold). Badge qualité (vert/orange). Lignes colorées : rouge = ref manquant, jaune = doublon.

**Raison :** Valider la récupération Overpass et la structure des données avant d'ajouter la complexité cartographique.

---

## 2026-04-21 — Analyse qualité des trous

**Choix :** Portage de `analyze_holes_quality()` du script Python en JS côté backend (`quality.js`). Groupement par tag `course`, détection des `ref` manquants et doublons.

**Raison :** Réutiliser la logique existante validée. La clé composite `course|ref` est le mécanisme de matching OSM golf standard.

---

## 2026-04-22 — Comparaison OSM ↔ cgolf.fr (scorecard)

**Choix :** Sur sélection d'un golf, affichage deux panneaux côte à côte :
- **Gauche (OSM)** : tableau trous avec toutes les colonnes (Ref, Par, Hcp, Black, White, Yellow, Blue, Red)
- **Droite (cgolf.fr)** : même structure, données issues de la scorecard analysée par IA vision

**Raison :** Permet de comparer visuellement les données OSM avec la réalité du parcours pour identifier les données manquantes ou incorrectes.

---

## 2026-04-22 — Analyse scorecard via Gemini Vision

**Choix :** `@google/genai` v1.50.1 + modèle `gemini-2.5-flash`. Résultat mis en cache dans `scripts/output/cgolf_holes_<slug>.json`.

**Raison :** Solutions alternatives écartées : Anthropic API (pas de crédits), Tesseract OCR (échec sur tableaux colorés), `@google/generative-ai` v0.x (déprécié, modèles indisponibles sur le free tier). `gemini-2.5-flash` fonctionne avec la clé `GEMINI_API_KEY` free tier. Le cache évite les appels répétés à l'API.

---

## 2026-04-22 — Matching multi-parcours sur même osm_id

**Choix :** `fetchCgolfHoles` retourne un tableau de tous les matches pour un `osm_id` (`.filter()` au lieu de `.find()`). Côté frontend, `findCgolfForCourse(cgolfData, courseKey)` sélectionne l'entrée cgolf dont `cgolfName` ou `cgolfUrl` contient le `courseKey` OSM (ex : "Montaplan" → parcours Montaplan).

**Raison :** Un complexe multi-parcours (ex : Golf du Gouverneur) a plusieurs entrées dans `match_results.json` avec le même `osm_id` mais des URLs cgolf différentes. Sans ce matching, tous les sous-parcours OSM affichaient la même scorecard (la première trouvée).
