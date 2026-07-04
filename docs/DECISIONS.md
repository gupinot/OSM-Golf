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

## 2026-04-22 — Filtre géographique golf=hole par zone leisure=golf_course

**Choix :** La requête Overpass `fetchHoles` utilise d'abord `area(areaId)` (areaId = 2400000000+wayId ou 3600000000+relationId). Si l'aire Overpass n'est pas indexée (retourne 0 éléments), fallback : requête radius + récupération de la géométrie du way via `fetchBoundary` + filtrage point-in-polygon côté backend. Fonction `deriveCourse(tags)` extrait le nom de sous-parcours depuis `name` ("Vert n°16 - Bois joli" → "Vert") quand le tag `course` est absent.

**Raison :** Éviter de ramener les trous des golfs voisins. L'index d'aires Overpass ne couvre pas toujours les ways (ex: Golf de Saint-Cloud `way/22752042`). Le filtrage polygon côté backend garantit la précision sans dépendre de l'index Overpass.

---

## 2026-04-22 — Retry Overpass sur erreurs transitoires

**Choix :** `query()` réessaie jusqu'à 5 fois sur le même endpoint pour les erreurs 504/503/429 avec backoff exponentiel (1s→2s→4s→8s→10s). Passage à l'endpoint suivant uniquement après épuisement des 5 essais. Erreurs non-transitoires (400, etc.) : sortie immédiate.

**Raison :** Les endpoints Overpass retournent des 504 intermittents. Réessayer sur le même endpoint avant de basculer sur le suivant est plus respectueux et efficace.

---

## 2026-04-22 — Matching cgolf.fr dynamique en Node.js (suppression match_results.json)

**Choix :** Remplacement du script Python `analyze_osm_cgolf.py` par un service Node.js dans `cgolf.js`. Scraping cgolf.fr à la demande par région géographique proche du golf sélectionné (rayon 200km sur centres de région prédéfinis). Double cache :
- `cgolf_regions_cache.json` : parcours cgolf par région scraped (réutilisé pour tous les golfs de la région)
- `cgolf_match_cache.json` : résultats de matching par osmId

Matching : token set ratio sur noms normalisés (stopwords supprimés) + filtre géo (fuzzy ≥60 ET ≤10km, ou ≤3km géo seul). Dépendance `cheerio` ajoutée pour parsing HTML.

**Raison :** Le `match_results.json` pré-généré était limité à Lyon. La nouvelle approche fonctionne pour n'importe quel golf en France, au fil des recherches, sans script batch à relancer.

---

## 2026-04-22 — Comparaison visuelle OSM ↔ scorecard par cellule

**Choix :** Mise en évidence colorée cellule par cellule entre le tableau OSM et le tableau scorecard :
- **Rouge** (`.cell-missing`) : valeur présente dans un tableau et absente dans l'autre
- **Orange** (`.cell-mismatch`) : valeur présente dans les deux mais différente (les deux cellules colorées)

Logique dans `buildComparison(osmHoles, cgolfHoles)` → map `ref → { par, handicap, distances }` avec statuts `missing-in-osm | missing-in-cgolf | mismatch | ok`. Appliqué via `cellClass(status, side)` dans `OsmUnifiedTable` (colonnes `golf=hole` uniquement) et `CgolfPanel`.

**Raison :** Permettre d'identifier d'un coup d'œil les écarts entre OSM et la scorecard officielle, sans avoir à comparer ligne par ligne manuellement.

---

## 2026-04-22 — Inférence du nom de parcours par préfixe commun des tags `name`

**Choix :** Suppression du pattern-matching par trou (`deriveCourse`). Remplacement par une analyse globale post-boucle (`inferCourseFromNames`) :
1. Pour chaque trou sans tag `course`, extraire les candidats de préfixe depuis `name` (avant ` n°NNN` ou ` - NNN` ou ` – NNN`)
2. Compter le nombre de trous partageant chaque candidat
3. N'assigner le candidat comme `course` que s'il apparaît dans ≥ 2 trous

**Raison :** Le pattern-matching fixe échouait pour des formats variés (ex : "Blanc - 8" pour Golf de Fourqueux). L'approche globale est robuste : si plusieurs trous partagent un même préfixe, c'est nécessairement le nom du parcours, sans supposer un format précis.

---

## 2026-04-23 — Bouton switch front/back sur la scorecard

**Choix :** Bouton "switch front/back" / "unswitch front/back" positionné absolument à droite du tableau scorecard, aligné sur la frontière trou 9/10. État `swappedCourses` (Set de courseKeys) dans `HolesTable`. La fonction `swapHalves` renumérote les trous : n ≤ 9 → n+9, n ≥ 10 → n-9, puis retrie par numéro croissant. La comparaison OSM ↔ scorecard est recalculée automatiquement après inversion. Positionnement via `useRef` sur la ligne du trou 10 (`offsetTop` + `translateY(-50%)`), bouton en dehors du `<table>` (`position: absolute; left: calc(100% + 8px)`).

**Raison :** Certains parcours ont l'aller et le retour inversés dans la scorecard récupérée (cgolf.fr ou source personnalisée). Le bouton permet de corriger visuellement cet écart sans modifier les données sources.

---

## 2026-06-24 — Fiabilisation des requêtes Overpass (406, timeout, endpoints, cache)

**Choix :** Refonte de la robustesse de `overpass.js` sur 4 axes :
1. **406 rendu retryable** : le 406 d'overpass-api.de est intermittent (load-shedding), pas fatal — la même requête repasse à 200 quelques secondes après. Ajouté à `RETRYABLE` ; le flag `isAreaNotFound` reste porté par l'erreur finale pour le fallback `area()` de `fetchHoles`, mais n'interrompt plus la boucle de retry.
2. **Timeout fetch 60 s → 25 s** (`FETCH_TIMEOUT`), aligné sur `[timeout:25]` du QL → plus d'attente d'une minute sur un mirror mort.
3. **Endpoints élargis et réordonnés** : ajout de `maps.mail.ru` (fiable aux tests) et `overpass.private.coffee` ; `maxAttempts` 5 → 3 puisqu'il y a désormais 4 endpoints et que le 406 bascule vite.
4. **Cache disque des recherches zone/nom** : `scripts/output/overpass_search_cache.json`, TTL 7 jours, clés `name:<nom>` et `zone:<lat>,<lng>,<radius>` (coords arrondies à ~100 m). Évite les requêtes identiques répétées qui martelaient Overpass.

**Raison :** L'utilisateur subissait des 502 systématiques après ~60 s : un seul 406 d'overpass-api.de faisait basculer immédiatement sur kumi.systems qui timeoutait à 60 s. Le retry du 406 + le failover rapide vers un mirror fiable + le cache suppriment ce scénario.

**Aussi :** Ajout d'un middleware de log requêtes/réponses dans `index.js` (`→ METHOD path` / `← status (ms)`).

---

## 2026-04-29 — Documentation projet (README.md)

**Choix :** Création du fichier `README.md` à la racine du projet. Contenu : description fonctionnelle, architecture, prérequis, installation, commandes de démarrage, variables d'environnement, routes API backend, scripts Python disponibles et système de cache.

**Raison :** Faciliter la prise en main du projet par un nouvel utilisateur sans avoir à lire le code source ou DECISIONS.md.

---

## 2026-06-24 — Stats de features par golf dans la liste de recherche (zone)

**Choix :** Affichage, pour chaque golf de la recherche par zone, d'un tableau de comptage des features OSM : trous / tees / greens (avec distinction **avec réf** / **sans réf**), fairways, bunkers.

Architecture **« Option A » (zone-wide)** : nouvel endpoint `GET /api/search/zone-stats?lat&lng&radius` + fonction `fetchZoneStats` (`overpass.js`) qui exécute **2 requêtes Overpass** quel que soit le nombre de golfs :
1. polygones des `leisure=golf_course` du rayon (`out body geom`) ;
2. `golf=hole|tee|green|fairway|bunker` du rayon (`out body geom`).

Chaque feature est attribuée au golf dont le polygone la contient (point-in-polygon sur un point représentatif : coords du node, ou centroïde du way). Résultat mis en cache disque (clé `stats:lat,lng,radius`, TTL 7 j, même mécanisme que le cache de recherche).

**Conventions de comptage :** `hole` compté sur les **ways uniquement** (le `node[golf=hole]` = drapeau → éviter le double comptage) ; `tee` sur way **et** node ; distinction avec/sans `ref` pour hole/tee/green ; fairways/bunkers = total simple (zones sans `ref` par convention).

**UX :** « liste d'abord, stats au fil de l'eau » — la liste s'affiche immédiatement (recherche inchangée), le comptage suit en async (`statsMap`/`statsLoading` dans `App.jsx`). `…` pendant le chargement, `–` si pas de données. `CourseList` passe de `<ul>` à `<table>` avec en-têtes groupés (Golf · Trous · Tees · Greens · Fairw. · Bunk.).

**Sidebar redimensionnable :** largeur par défaut 660 px pour afficher toutes les colonnes, + poignée de glissement à la souris (`.sidebar-resizer`, bornes 320–1100 px).

**Raison :** Donner une vue d'ensemble immédiate de la qualité/complétude des données OSM par golf (ex. tees souvent sans `ref`, greens non taggés) sans cliquer sur chaque parcours. L'approche 2-requêtes respecte l'effort anti-martèlement Overpass (cf. fiabilisation du 2026-06-24).

**Piège résolu :** `out geom tags;` sur une relation `type=multipolygon` **omet les membres** (le niveau de détail `tags` les exclut) → aucune géométrie, polygone introuvable, golfs multipolygon (Gouverneur, Lyon Verger) sans stats. Correctif : `out body geom;` (le niveau `body` inclut tags **et** membres).

**Hors périmètre (incrément futur) :** la recherche **par nom** n'affiche pas encore les stats (golfs potentiellement dispersés, pas de centre/rayon défini).

---

## 2026-06-24 — Stats zone : fairways/greens/bunkers en relation multipolygon

**Choix :** La requête features de `fetchZoneStats` interroge aussi `relation["golf"="green"|"fairway"|"bunker"]` (en plus des `way`). `representativePoint` gère les relations (centroïde via membres `outer`, réutilise `extractPolygon`).

**Raison :** Beaucoup de fairways/greens/bunkers sont taggés sur des relations `type=multipolygon` (outer + inner pour découper bunker/green) — ils étaient invisibles (ex. Golf d'Hossegor : 6 fairways comptés au lieu de 18). Pas de double comptage : le tag `golf=*` est porté par la relation, pas par les ways membres (non taggés).

---

## 2026-06-24 — Fix matching cgolf.fr : longitudes ouest (signe négatif)

**Choix :** Regex GPS de `fetchDetailInfo` (`cgolf.js`) corrigé de `([\d.]+)` vers `(-?[\d.]+)` pour lat **et** lng.

**Raison :** `L.latLng('43.51', -1.52)` — toute longitude ouest de Greenwich est négative ; l'ancien regex échouait, `fetchDetailInfo` retournait `null`, et le golf était silencieusement exclu de la liste cgolf. Bug systémique sur toute la côte ouest (Aquitaine/Biarritz, Bretagne, Cotentin…). Caches purgés après correctif : régions `aquitaine`/`normandie` + entrées de match vides.

---

## 2026-06-24 — Affectation géométrique du ref des greens/tees (écriture OSM)

**Choix :** Nouvelle action (bouton **🎯 Affecter ref greens/tees** dans l'en-tête Source OSM, changeset dédié, indépendant de cgolf) : `assignRefsFromGeometry(osmId, lat, lng, {preview})` dans `osm-write.js`.
- **Green sans `ref`** ← `ref` du `golf=hole` dont le **dernier point** (arrivée) est dans le polygone du green.
- **Tee-way sans `ref`** ← `ref` du `golf=hole` dont le **premier point** (départ) est dans le polygone du tee.
- Écrit `ref` + `course` (si manquant) ; ne touche jamais un ref existant ; conflits (plusieurs holes dans une zone) ignorés et signalés. Mode preview avant écriture.
- `fetchHoles` enrichi (additif) : holes `firstPoint`, greens/tees `osmId`/`osmType` + geometry des tees. Route `POST /api/holes/assign-refs`.

**Raison :** Permettre de compléter en masse les `ref` manquants des greens/tees directement depuis l'appli, sans édition manuelle dans iD/JOSM, en exploitant la géométrie déjà présente dans OSM.

**Hors v1 :** tees-nodes (pas d'aire → règle de containment inapplicable), greens en relation multipolygon.

---

## 2026-06-24 — Colonne `nocolor` dans la section golf=tee

**Choix :** `analyzeTeeGreenQuality` compte par `course|ref` les tees ayant un `ref` mais aucun tag couleur (`teeMap[key].nocolor`). Nouvelle sous-colonne `nocolor` dans la section `golf=tee` du tableau OSM (`colSpan` 5→6) : `⚠️` / `⚠️ N` / `—`.

**Raison :** Identifier les tees référencés mais non typés par couleur (donnée incomplète invisible dans les colonnes Bla/Whi/Yel/Blu/Red).

---

## 2026-06-25 — Bouton « Rafraîchir » de la liste (bypass du cache disque Overpass)

**Choix :** Bouton ↻ dans l'en-tête « Golf » du tableau de résultats (`CourseList`) qui rejoue la **dernière recherche** (nom ou zone) en contournant le cache disque 7 j.
- **Backend :** paramètre `fresh=1` optionnel sur `/api/search/name`, `/api/search/zone`, `/api/search/zone-stats`. Propagé en `{ fresh }` à `searchByName` / `searchByZone` / `fetchZoneStats` (`overpass.js`) : quand `fresh`, on **saute `getCached()`** mais on appelle toujours `setCached()` → le cache est rafraîchi, pas ignoré.
- **Frontend :** `api.js` propage `fresh` ; `SearchPanel` mémorise le `query` dans le payload `onResults` (mode nom) pour pouvoir le rejouer ; `App.handleRefreshSearch()` rejoue la recherche + recharge les stats fraîches (mode zone). Helper `loadStats(results, fresh)` factorisé.
- **UX :** au clic, la liste affichée est d'abord **vidée** (`setSearchResults(null)` + `setStatsMap(null)` + `setLoading(true)` → « Recherche en cours… ») puis régénérée avec les données fraîches.

**Raison :** Les résultats venaient systématiquement du cache (TTL 7 j) sans moyen de forcer une requête Overpass à jour. Le bypass + réécriture du cache permet de rafraîchir à la demande sans invalider manuellement le fichier de cache.

---

## 2026-06-25 — Fix dialog modale : bouton de fermeture hors écran sur longues listes

**Choix :** `.modal` borné à `max-height: 90vh` et `.modal-changes` (liste des trous modifiés) rendu défilant (`overflow-y: auto; max-height: 60vh`). Couvre les 3 modales partageant la classe (mise à jour OSM + 2 aperçus « Affecter ref greens/tees »).

**Raison :** Sur un parcours 18 trous, la liste des changements rendait la modale plus haute que le viewport et poussait le bouton « Fermer » hors champ, inatteignable. La liste défile désormais à l'intérieur ; titre, résumé et actions restent toujours visibles.

---

## 2026-07-04 — Persistance de session (survie aux reloads HMR Vite)

**Choix :** Sauvegarde de `searchResults` + `selectedCourse` dans `sessionStorage` (clé `osmgolf.session`, `App.jsx`), réhydratés via les initialiseurs `useState` au chargement. Un `useEffect` de montage relance les fetchs dérivés : stats zone (`loadStats`), trous OSM + scorecard cgolf via le helper extrait `loadCourseData` (partagé avec `handleSelectCourse`). Les gros volumes (trous, scorecard, stats) ne sont **pas** stockés — re-récupérés au montage (bénéfice du cache disque backend). `try/catch` autour de `sessionStorage` (mode privé/quota).

**Raison :** En dev, le client HMR de Vite force un `location.reload()` complet après reconnexion de son WebSocket (onglet inactif, mise en veille machine) → tout l'état React en mémoire était effacé, ramenant à l'écran de recherche vide. La persistance de session restaure la liste et le golf sélectionné. Portée onglet : un nouvel onglet repart vierge, la fermeture de l'onglet efface l'état (comportement attendu pour une session de travail). Disparaît en build de production (pas de HMR).

---

## 2026-07-04 — Affectation ref tees : règle du « premier segment » (au lieu du seul point de départ)

**Choix :** La règle d'affectation du `ref` des tees-way passe du **point de départ** (`firstPoint` dans le polygone) au **premier segment** du tracé `golf=hole` : le tee reçoit le `ref` du hole dont le segment `départ → 1er point du tracé` (`firstPoint → secondPoint`) **traverse** le polygone du tee.
- `overpass.js` : ajout de `secondPoint` (2ᵉ point de la géométrie) sur chaque hole.
- `osm-write.js` : primitives géométriques `segmentsIntersect(p1,p2,p3,p4)` (test d'orientation par produits croisés) et `segmentIntersectsPolygon(a,b,polygon)` (endpoint dedans OU croisement d'une arête). `propose()` généralisé pour accepter un prédicat `matchFn(hole, el)` au lieu d'un extracteur de point — greens inchangés (`lastPoint` dans le polygone), tees via le premier segment.

**Raison :** Un `golf=hole` part souvent du **tee arrière** ; les tees avancés alignés en enfilade sur l'axe de jeu n'étaient pas captés par le seul containment du point de départ. Le premier segment traverse toute la rangée de tees départ et est un **sur-ensemble strict** de l'ancienne règle (départ = extrémité du segment).

---

## 2026-07-04 — Buffer de tolérance (25 m) sur le filtre polygonal du fallback `fetchHoles`

**Choix :** Dans le chemin fallback de `fetchHoles` (quand `area()` Overpass renvoie 0 → filtrage point-in-polygon côté backend contre la limite `leisure=golf_course`), le filtre `elementInPolygon` tolère désormais une marge de **25 m** hors du polygone (`BOUNDARY_BUFFER_M`). Ajout de `distPointToSegmentM(lat,lon,a,b)` (distance point→segment, approx. planaire locale avec `cos(lat)`) et `pointNearPolygon(lat,lon,polygon,bufferM)` (dans le polygone OU à ≤ bufferM d'une arête). Nodes et ways (au moins un nœud dans la marge) concernés.

**Raison :** Bug constaté au Golf des Ormes (`way/156597577`) : le 2ᵉ tee du trou 6 (et un autre départ arrière) n'était pas affecté alors qu'aligné dans l'axe du premier segment. Cause réelle diagnostiquée : la limite OSM du golf_course est tracée **trop serrée** et exclut les départs arrière situés 7–16 m dehors → le filtre polygonal les écartait **en amont** de toute affectation. Correctif systémique (bénéficie aussi aux stats qualité, mêmes features filtrées). Vérifié en preview : le tee 622 est désormais capté (`ref=6`), filtre 82→70 au lieu de 82→68.
