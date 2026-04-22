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

## 2026-04-22 — Analyse qualité golf=tee et golf=green

**Choix :** Nouvelle requête Overpass unifiée (`out body geom`) récupérant en une passe `golf=hole` + `golf=tee` (way et node) + `golf=green` avec géométrie complète. Analyse côté backend (`analyzeTeeGreenQuality`) :
- Tees : map `course|ref → { black, white, yellow, blue, red }` (présence d'une zone tee par couleur)
- Greens : map `course|ref → 'tagged' | 'untagged' | 'missing'` avec point-in-polygon (ray casting) pour détecter les greens existants sans tag `ref`

**Raison :** Complète le diagnostic qualité OSM au-delà des seuls `golf=hole` — permet d'identifier les tees et greens manquants ou mal taggés.

---

## 2026-04-22 — Tableau OSM unifié (golf=hole + golf=tee + golf=green)

**Choix :** Un seul `<table>` avec deux lignes d'en-tête groupées (colspan/rowspan) : `golf=hole` (7 cols), `golf=tee` (5 cols), `golf=green` (1 col). Le tableau cgolf reçoit également une ligne de groupe (`scorecard`) pour aligner les lignes de données verticalement. Hauteurs fixes via CSS (`thead tr: 28px`, `tbody tr: 32px`).

**Raison :** Lecture horizontale naturelle par trou ; alignement visuel garanti entre OSM et cgolf.fr.

---

## 2026-04-22 — Refonte IHM : layout grid + titres restructurés

**Choix :**
- `holes-header` réduit au seul nom du golf (h2)
- Panneau gauche renommé "Source OSM" : badge qualité, bouton Éditer OSM et refresh déplacés dans son en-tête
- Panneau droit renommé "Carte de score officielle — [source]" (cgolf.fr ou nom source perso)
- Bouton "+ Autre source" renommé "Changer source" ; toujours visible ; quand source perso active et fallback cgolf disponible, propose "↩ Revenir à cgolf.fr" dans le panneau
- `panels-layout` converti en CSS Grid 3 colonnes × 2 rangées : rangée 1 = en-têtes, rangée 2 = tableaux ; le séparateur s'étend sur les 2 rangées

**Raison :** Les contrôles OSM appartiennent visuellement à la source OSM, pas au titre global. Le grid garantit l'alignement des tableaux quelle que soit la hauteur des en-têtes.

---

## 2026-04-22 — Bouton "Éditer OSM" sur le panneau trous

**Choix :** Lien `✏️ Éditer OSM` dans le header du panneau trous, ouvre `https://www.openstreetmap.org/edit#map=17/{lat}/{lng}` dans un nouvel onglet.

**Raison :** Accès direct à l'éditeur OSM centré sur le golf sélectionné, sans avoir à naviguer manuellement.

---

## 2026-04-22 — Lien vers la page cgolf.fr dans le panneau scorecard

**Choix :** Bouton `↗` dans le titre du panneau cgolf.fr, visible uniquement quand `match.cgolfUrl` est disponible, ouvre la page cgolf dans un nouvel onglet.

**Raison :** Accès rapide à la source de référence pour vérification visuelle.

---

## 2026-04-22 — Source de scorecard personnalisée (URL ou fichier local)

**Choix :** Bouton `+ Autre source` dans le panneau cgolf permettant de fournir soit une URL d'image soit un fichier local (drag&drop ou sélection). Appelle `POST /api/cgolf-holes/analyze` qui réutilise `analyzeScorecard` (Gemini Vision). Le résultat remplace le `match` cgolf.fr pour le sous-parcours concerné. Un bouton `× Réinitialiser` revient à la source cgolf.fr. État `customSources` (map courseKey → résultat) dans `HolesTable`, réinitialisé via `key={osmId}` à chaque changement de golf.

**Raison :** Certains golfs ne sont pas référencés sur cgolf.fr, ou leur scorecard peut être disponible ailleurs (site officiel, photo). Permet l'analyse et la comparaison OSM avec n'importe quelle source d'image.

---

## 2026-04-22 — Matching multi-parcours sur même osm_id

**Choix :** `fetchCgolfHoles` retourne un tableau de tous les matches pour un `osm_id` (`.filter()` au lieu de `.find()`). Côté frontend, `findCgolfForCourse(cgolfData, courseKey)` sélectionne l'entrée cgolf dont `cgolfName` ou `cgolfUrl` contient le `courseKey` OSM (ex : "Montaplan" → parcours Montaplan).

**Raison :** Un complexe multi-parcours (ex : Golf du Gouverneur) a plusieurs entrées dans `match_results.json` avec le même `osm_id` mais des URLs cgolf différentes. Sans ce matching, tous les sous-parcours OSM affichaient la même scorecard (la première trouvée).

---

## 2026-04-22 — Comparaison visuelle OSM ↔ scorecard par cellule

**Choix :** Mise en évidence colorée cellule par cellule entre le tableau OSM et le tableau scorecard :
- **Rouge** (`.cell-missing`) : valeur présente dans un tableau et absente dans l'autre
- **Orange** (`.cell-mismatch`) : valeur présente dans les deux mais différente (les deux cellules colorées)

Logique dans `buildComparison(osmHoles, cgolfHoles)` → map `ref → { par, handicap, distances }` avec statuts `missing-in-osm | missing-in-cgolf | mismatch | ok`. Appliqué via `cellClass(status, side)` dans `OsmUnifiedTable` (colonnes `golf=hole` uniquement) et `CgolfPanel`.

**Raison :** Permettre d'identifier d'un coup d'œil les écarts entre OSM et la scorecard officielle, sans avoir à comparer ligne par ligne manuellement.
