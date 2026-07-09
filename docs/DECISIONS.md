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

---

## 2026-07-07 — Portage sur Firebase (lift-and-shift, mode proxy OSM conservé)

**Choix :** Migration de l'app locale (backend Express + frontend Vite) vers Firebase sans changer les fonctionnalités : IHM statique sur Firebase Hosting, backend conteneurisé sur Cloud Run, `/api/**` routé par rewrite Hosting → Cloud Run (`firebase.json`). La référence des données reste OpenStreetMap (proxy). La persistance Firestore est reportée à un incrément ultérieur (« second temps »).

**Raison :** Découpler le risque « infra/déploiement » du risque « refonte données » : valider hébergement, réseau et build d'abord, faire évoluer le modèle de données ensuite.

---

## 2026-07-07 — Compute : Cloud Run + conteneurisation backend

**Choix :** Backend Express empaqueté dans une image `node:22-slim` (single-stage, non-root, `backend/Dockerfile`), déployée sur Cloud Run via Cloud Build (`--source`, pas de Docker local), `min=max=1` instance. Variable `CACHE_DIR` pour rediriger les caches disque (`overpass.js`, `cgolf.js`) vers `/tmp/osm-golf`. Le backend lit déjà `process.env.PORT` (compat Cloud Run 8080).

**Raison :** L'Express existant se conteneurise tel quel ; Cloud Run gère bien les appels externes longs (Overpass/Gemini/scraping). `min=max=1` garde le token OSM en mémoire vivant (persistance propre reportée à Firestore) ; FS Cloud Run éphémère et non inscriptible hors `/tmp` → caches volatils, sans impact fonctionnel.

---

## 2026-07-07 — Authentification & habilitation (Firebase Auth Google + allowlist)

**Choix :** Application entièrement fermée. Frontend : gate de connexion Google (SDK `firebase`, config via `VITE_FIREBASE_*`), ID token `Bearer` attaché à tous les appels `/api` via le helper `apiFetch` (`services/http.js`). Backend : middleware `firebase-admin` (API modulaire v14, `middleware/auth.js`) vérifiant l'ID token sur tout `/api`, + allowlist d'emails (`AUTHORIZED_EMAILS`, CSV) **fail-closed** (liste vide → 403). Bypass dev explicite `AUTH_DISABLED=1` ; en dev local sans config Firebase, l'appli tourne ouverte.

**Raison :** L'app passe sur Internet → protéger l'écriture OSM et les appels Gemini (coût). « Login obligatoire » ne suffit pas (n'importe quel compte Google entrerait) → allowlist. Dev local inchangé grâce aux bypass.

---

## 2026-07-07 — Tooling de déploiement scripté (`deploy/`)

**Choix :** Dossier `deploy/` de scripts bash paramétrés (`--help`, aucune valeur en dur), chargeant automatiquement `deploy/.env` (gitignoré) : `00-enable-apis` (APIs GCP + projet + grant `cloudbuild.builds.builder` au SA compute), `10-secrets` (Secret Manager + grant `secretAccessor`), `20-deploy-backend` (Cloud Run, liste `--set-secrets` dynamique → OSM optionnel), `30-deploy-frontend` (build `VITE_*` + Hosting), `deploy-all` (orchestration). README réécrit. Règle projet ajoutée (CLAUDE.md) : toute opération manuelle → script paramétré + documentation.

**Raison :** Reproductibilité, secrets hors git et hors historique shell, opérations rejouables. Le grant `cloudbuild.builds.builder` corrige l'échec de build « from source » (projets GCP récents : le compte de service compute par défaut, désormais identité de build, manque des droits).

---

## 2026-07-07 — Architecture cible Firestore (analyse validée, phase ultérieure — non implémentée)

**Choix (décidé, à implémenter au « second temps ») :** Firestore comme référence primaire nourrie par OSM en ingestion asynchrone ; hiérarchie `golfs → courses → versions` + `scorecards` (images en Cloud Storage) + `plans` ; versioning par **snapshots complets immuables** ; recherche géo par **geohash**, par nom **fuzzy in-memory** (token-set-ratio), et par id ; scorecards multi-parcours via `coversCourses[]` (cas des 9 trous combinés, ex. cap d'Agde) ; sauvegardes PITR + scheduled backups + export GCS.

**Raison :** Consigner les décisions d'architecture prises pendant l'analyse pour ne pas les reperdre, même si l'implémentation est reportée.

---

## 2026-07-08 — Refonte IHM : navigation multi-pages (routing) + page d'accueil

**Choix :** Introduction d'un routeur (`react-router-dom`, `BrowserRouter`) et passage d'une page unique à une IHM multi-pages sous un layout commun (`components/Layout.jsx` : en-tête marque + navigation Accueil/Recherche/OSM Proxy + bloc utilisateur/déconnexion). L'application historique (recherche + `HolesTable`) est déplacée **à l'identique** sur la route `/osmproxy` (`pages/OsmProxyPage.jsx`). Nouvelle **page d'accueil** `/` (`pages/HomePage.jsx`) en **coquille avec états vides** : carte de France (`react-leaflet` + tuiles OSM, sans marqueurs), stats à 0, listes « aucun parcours », bandeau « base à venir ». La gate d'auth reste au-dessus du routeur (toutes les routes exigent la connexion). `firebase.json` inchangé (les rewrites SPA `**`→`index.html` servent déjà les URLs profondes).

**Raison :** Faire évoluer largement l'IHM (Accueil, Recherche, Détail) tout en conservant l'outil de diagnostic existant comme « OSM Proxy ». Les données « en base » (parcours, stats, derniers ajoutés/édités) dépendent de Firestore (non encore alimenté) → accueil construit en coquille, branchement réel reporté au 2ᵉ temps.

**Aussi :** correctif de persistance — `OsmProxyPage` lit sa session `sessionStorage` **au montage** (et non au niveau module) pour que la navigation client Accueil ↔ OSM Proxy restaure la dernière recherche/sélection.

---

## 2026-07-08 — Écran de recherche (`/search`)

**Choix :** Page dédiée réutilisant `SearchPanel` (recherche OSM par nom / par zone). Sélecteur de source `OSM · Base · Les deux` avec **Base et Les deux désactivés** (« à venir », Firestore). Résultats avec bascule **Liste / Carte** : liste (nom + ville + distance + indicateurs de présence `OSM ✓` / `Base —`), carte Leaflet (`CircleMarker` vectoriel — pas d'icône image à charger — recentrée sur les résultats via `fitBounds`). Un clic sur un résultat navigue vers `/course/:id` (identifiant = `osmId` avec `/`→`-`, ex. `way-22752042`), l'objet parcours complet passé via le `state` du routeur. La dernière recherche (résultats + vue) est **persistée en `sessionStorage`** (clé `osmgolf.search`) → retour depuis le détail ou reload restaure la liste/carte.

**Raison :** L'indicateur/score de qualité et le filtre par niveau de qualité ne sont pas encore calculables en liste (le score OSM n'existe qu'après chargement des trous ; les stats zone ne sont que des comptages) → reportés ; en v1 seuls les indicateurs de présence sont affichés. Sources Base/les-deux désactivées car Firestore absent.

---

## 2026-07-08 — Écran détail parcours (`/course/:id`) : zones pliables + delta, extraction de briques partagées

**Choix :** Extraction des briques réutilisables de `HolesTable` dans un module partagé (`components/holes/` : `compare.js` = `buildComparison`/`cellClass`/`findCgolfForCourse`/`swapHalves`/`ALL_COLORS` ; `tables.jsx` = `QualityBadge`/`OsmUnifiedTable`/`CgolfPanel` ; `CustomSourceInput.jsx`). `HolesTable` (OSM Proxy) ré-importe ces briques, comportement **inchangé**. Nouvelle page `pages/CoursePage.jsx` : sous-header (retour, nom + badge qualité, bouton **Delta**) et body en **3 zones pliables disposées en colonnes** — **Parcours en base** (gauche, placeholder Firestore), **Parcours OSM** (centre, dépliée par défaut), **Carte de parcours** (droite). Chaque colonne pliée se réduit à une bande verticale étroite (titre à la verticale). Chargement **paresseux** par zone (déclenché au dépliage dans le handler ; chargement initial OSM par effet de montage) : trous via `fetchHoles`, scorecard via `fetchCgolfHoles`, gardés en mémoire (pas de re-fetch). Le **delta** (coloration cellule par cellule OSM↔carte, réutilise `buildComparison`) s'active depuis le header uniquement quand les zones OSM et Carte sont dépliées. Parcours ouvert persisté en `sessionStorage` (reload / lien direct restauré, sinon message « ouvrir depuis la recherche »).

**Raison :** L'écran détail est un sur-ensemble de l'outil OSM Proxy → réutiliser ses briques évite la duplication et garantit la cohérence. Périmètre v1 volontairement limité à la **lecture + delta** ; sont **reportés** : sélecteur de référence du delta (OSM/base/carte — utile seulement à 3 sources), et toute l'**édition** (report carte→OSM/base, report OSM↔base, association ref/couleur, détection de zones, édition manuelle du tableau, composition multi-parcours, dry-run/propagation en 2 étapes).

---

## 2026-07-08 — Fix scroll de la liste de résultats (page recherche)

**Choix :** Ajout de la règle `.search-page > * { flex-shrink: 0; }` dans `App.css`.

**Raison :** Le `<main class="page search-page">` cumule `.page` (conteneur défilant, `overflow-y:auto`, hauteur bornée par `flex:1`) et `.search-page` (`display:flex; flex-direction:column`). Ses enfants sont donc des items flex. `.results-block`, ayant `overflow:hidden` (pour clipper ses coins arrondis), voyait — par la spec CSS — son `min-height:auto` résolu à **0** au lieu de `min-content` : flexbox l'écrasait à la hauteur du viewport (1053 px pour 2519 px de contenu) et **rognait les parcours en trop** (liste de 43 coupée, aucun défilement possible). En empêchant la compression des enfants, le contenu déborde de `.page` qui réactive son propre scroll.

**Vérifié (Playwright, viewport 939×1285) :** avant → `.page` non défilable (`scrollH==clientH`), `.results-block` compressé à 1053 px ; après → `.page` défilable (`scrollH 2788 > clientH 1234`), `.results-block` à sa hauteur naturelle (2519 px), 43ᵉ ligne atteignable, en-tête fixe. Page d'accueil non affectée (contenu tient dans le viewport).

---

## 2026-07-09 — Détail parcours : alignement des lignes de trous entre zones (grille subgrid)

**Choix :** Le body de `CoursePage` passe de 3 colonnes flex indépendantes à une **grille CSS** dont les colonnes (48px si repliée, sinon `1fr`) et les pistes de lignes (`auto repeat(N, auto auto)` = en-tête de zone + [bande titre, tableau] par sous-parcours) sont calculées inline. Les zones dépliées se calent sur ces pistes partagées via **`grid-template-rows: subgrid`** ; `.zone-body`/`.course-group` passent en `display:contents` pour que leurs bandes deviennent des items directs de la grille (padding de corps réinjecté sur chaque bande, séparateur déplacé sur `.zone-head`). Côté Carte, le titre du sous-parcours est **fusionné dans la bande source** (une seule bande titre, symétrique du `.course-key` OSM toujours rendu même vide). `.cgolf-panel-outer` passe en `justify-self:start` pour que le bouton *switch front/back* (positionné à droite du tableau) ne soit pas rogné par `overflow:hidden`.

**Raison :** Les zones empilaient leur contenu indépendamment ; la rangée de contrôles source côté Carte décalait sa scorecard d'~une ligne, désalignant trou 1 OSM et trou 1 Carte. Les lignes de table étant **déjà à hauteur fixe** (`thead tr 28px`, `tbody tr 32px`, identiques des deux côtés), il suffit d'égaliser les bandes **au-dessus des tbody** pour que les tables démarrent au même Y → alignement trou à trou. Le subgrid (plutôt que des hauteurs fixes par ligne) auto-égalise ces bandes et gère le cas du panneau « Changer source » **inline** : quand il s'ouvre, la piste partagée grandit et fait descendre les deux colonnes ensemble, l'alignement tient. **Limite connue :** pour un golf multi-parcours dont un sous-parcours a un nombre de trous différent entre OSM et cgolf, les tables se calent en haut mais divergent en bas (inévitable), le sous-parcours suivant se réaligne.

---

## 2026-07-09 — Modèle de données Firestore : provenance, géométries, identité (analyse validée)

**Choix :** Détail du modèle de persistance (affine l'architecture cible du 2026-07-07). Hiérarchie `golfs/{golfId} → courses/{courseId} → versions/{n}` + `courses/{courseId}/sources/{sourceId}` (couches brutes, ex. dernier fetch OSM) + `golfs/{golfId}/scorecards/{scorecardId}` (image + décodage, `coversCourses[]`).
- **Provenance « champ emballé »** : toute information atomique = `{ v, src, at }`. `src` ∈ 4 origines encodées en clair : `osm`, `card-original:{scorecardId}`, `card-manual:{scorecardId}`, `manual`. Couvre la date de dernière MAJ au niveau champ **et** parcours (`updatedAt`).
- **Géométries hors Firestore** : tracés de trous + fairways/greens/tees/bunkers en **GeoJSON dans Cloud Storage**, une `FeatureCollection` par version ; `properties` portent `ref`/`color` emballés. Évite la limite 1 MiB des docs Firestore et se branche direct sur Leaflet.
- **Identité** : `golfId`/`courseId` **générés stables**, avec `golfs.osm.{type,id,ref}` **indexé** (lookup mono-champ sur `osm.ref`) pour une ré-ingestion idempotente.
- **Merge / ré-ingestion** : écriture champ-par-champ selon une politique par famille (géométries/refs → OSM ; par/hcp/distances → cartes) ; un `src:"manual"` ou `card-*` n'est **jamais** écrasé par un re-fetch OSM.

**Raison :** Tracer finement l'origine de chaque donnée (exigence : OSM / carte d'origine / carte modifiée / édition manuelle) + versioning par snapshots immuables. Le champ emballé rend la provenance lisible et locale ; GeoJSON/Storage contourne la limite de taille ; l'id généré résiste aux changements d'id OSM.

**Découpage retenu (5 incréments) :** ① socle données, ② ingestion OSM, ③ scorecards, ④ merge & versioning, ⑤ branchement IHM.

---

## 2026-07-09 — Couche données : incrément ① (socle Firestore + Storage)

**Choix :** Mise en place du socle, **collections vides** (aucune ingestion).
- **Provisioning scripté** : `deploy/40-provision-data.sh` (APIs Firestore/Storage, base Firestore, bucket de données, IAM `datastore.user` + `storage.objectAdmin` au SA compute ; idempotent) et `deploy/45-deploy-firestore.sh` (déploie règles + index via `firebase deploy`). Intégrés à `deploy-all.sh` ; variables `FIRESTORE_LOCATION`/`DATA_BUCKET`/`BUCKET_LOCATION` dans `deploy/.env`.
- **Accès backend uniquement** (Admin SDK) : `services/firebase-app.js` (init partagée avec l'auth), `services/firestore.js` (`getDb`/`getBucket`), `data/schema.js` (chemins + provenance). Règles `firestore.rules`/`storage.rules` **deny-all** fail-closed (aucun accès client direct) ; `firebase.json` étendu (sections `firestore`/`storage`).
- **Health-check** : `GET /api/base/health` — pré-flight des identifiants ADC + timeout borné → **503 lisible sans crash** ; en prod (ADC Cloud Run), lecture Firestore réelle → `ok:true`.

**Raison :** Découpler l'infra données du métier ; valider connectivité et sécurité avant toute ingestion. Le pré-flight ADC évite un retry gRPC non catché **fatal en Node ≥ 15** quand la base est injoignable (le timeout seul ne suffit pas : la rejection vient d'une promesse interne au SDK).

**Aussi :** correctif `.gitignore` — motif `Data/` non ancré → ancré `/Data/` (il ignorait silencieusement tout dossier `data/`, dont `backend/src/data/`).
