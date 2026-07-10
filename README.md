# OSM Golf Explorer

Outil web de diagnostic et de comparaison des données golf OpenStreetMap avec les
scorecards officielles. Déployable sur Firebase (Hosting + Cloud Run), accès protégé
par authentification Google. La référence des données reste OpenStreetMap (mode proxy) ;
la persistance Firestore est en cours d'introduction (socle posé, ingestion à venir).

## Fonctionnalités

- **Recherche de golfs** par nom ou par zone géographique (ville ou géolocalisation, rayon 5–100 km)
- **Tableau de trous OSM** — données `golf=hole`, `golf=tee`, `golf=green` avec analyse qualité (refs manquants, doublons)
- **Comparaison visuelle OSM ↔ scorecard officielle** — matching automatique avec cgolf.fr, coloration cellule par cellule (rouge = absent, orange = divergent)
- **Analyse scorecard par IA** — lecture d'images de scorecards via Gemini Vision (URL ou fichier local)
- **Source personnalisée** — remplacement de la scorecard cgolf.fr par n'importe quelle image
- **Écriture OSM** — affectation géométrique des `ref`/couleurs des greens/tees, report scorecard → OSM (OAuth OSM)
- **Switch front/back** — inversion aller/retour sur la scorecard pour corriger les écarts d'ordre

## Navigation (IHM)

L'application est une SPA multi-pages (routage `react-router-dom`, `BrowserRouter`).
Les rewrites Firebase Hosting servent `index.html` pour toute URL hors `/api/**`, donc
l'accès direct à une URL profonde fonctionne.

| Route          | Page          | État                                                        |
|----------------|---------------|-------------------------------------------------------------|
| `/`            | Accueil       | Carte de France + stats + derniers parcours (données « en base » à venir avec Firestore ; coquille avec états vides pour l'instant) |
| `/osmproxy`    | OSM Proxy     | Outil de diagnostic/comparaison OSM ↔ scorecard (l'app historique) |
| `/search`      | Recherche     | Recherche OSM (par nom / par zone), résultats en liste ou carte, indicateurs de présence OSM/Base ; clic → détail. Sources Base/Les deux désactivées (Firestore à venir) |
| `/course/:id`  | Détail parcours | Zones pliables (Base placeholder / OSM / Carte scorecard), chargement paresseux par zone, delta de comparaison OSM↔carte. Édition (report, association ref, détection zones) à venir |

Toutes les routes exigent la connexion (gate d'auth au-dessus du routeur). En dev local
sans config Firebase, l'appli est ouverte.

## Architecture

```
Navigateur ──login Google──►  Firebase Hosting (IHM React/Vite, statique)
                                    │  rewrite /api/**
                                    ▼
                              Cloud Run (backend Express, conteneurisé)
                                    │  vérif ID token Firebase + allowlist email
                                    ├─► Overpass / Nominatim / cgolf.fr
                                    ├─► Gemini Vision      (Secret Manager)
                                    ├─► OSM write API       (Secret Manager)
                                    └─► Firestore + Cloud Storage (couche données, Admin SDK)
```

Le frontend ne parle jamais directement à Firestore/Storage : tout passe par `/api`
(Admin SDK côté backend). Les règles Firestore/Storage sont donc *deny-all* fail-closed.

```
OSM-Golf/
├── backend/        # Express (Node.js) — proxy Overpass, scraping cgolf.fr, analyse qualité, écriture OSM
│   ├── Dockerfile  # image Cloud Run (node:22-slim, non-root)
│   └── src/
│       ├── routes/     # search, holes, cgolf-holes, osm-auth, base (health + ingest + scorecards)
│       ├── services/   # overpass, cgolf, quality, nominatim, osm-write, osm-auth, firestore, firebase-app, ingest-osm, scorecards
│       ├── data/       # schema (chemins + provenance), golfs, geometry, scorecards (repositories)
│       └── middleware/ # auth (vérif ID token Firebase + allowlist)
├── frontend/       # React + Vite (react-router-dom, react-leaflet)
│   └── src/
│       ├── pages/      # HomePage, OsmProxyPage, SearchPage, CoursePage
│       ├── components/ # Layout (header + nav), SearchPanel, CourseList, HolesTable
│       └── services/   # api, http (apiFetch), firebase (auth)
├── deploy/         # scripts de déploiement paramétrés (Cloud Run + Hosting + données + secrets)
├── firebase.json   # config Hosting + rewrite /api → Cloud Run + Firestore/Storage
├── firestore.rules / storage.rules / firestore.indexes.json   # couche données (deny-all client)
└── scripts/        # outils Python batch (legacy) + caches générés (scripts/output/)
```

## Prérequis

- Node.js ≥ 18
- Clé API Gemini (`GEMINI_API_KEY`) — free tier suffisant
- Pour le déploiement : `gcloud` (Google Cloud CLI) et `firebase` (Firebase CLI)

## Développement local

En local, l'authentification est **désactivée** (appli ouverte sur `localhost`) : le
backend se lance avec `AUTH_DISABLED=1` et le frontend sans config Firebase.

Lancer les deux processus dans des terminaux séparés :

```bash
# Terminal 1 — Backend (port 3001)
cd backend
npm install
AUTH_DISABLED=1 GEMINI_API_KEY=<votre_clé> npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm install
npm run dev
```

L'application est accessible sur [http://localhost:5173](http://localhost:5173).
Le frontend proxy les requêtes `/api/*` vers le backend `http://localhost:3001`.

## Déploiement (Firebase + Cloud Run)

### Prérequis manuels (non scriptables, à faire une fois)

1. Créer un **projet Firebase** (plan **Blaze**, requis pour Cloud Run et l'egress réseau).
2. Installer et authentifier les CLIs :
   ```bash
   brew install --cask google-cloud-sdk
   npm i -g firebase-tools
   gcloud auth login
   firebase login
   ```
3. Dans la console Firebase → **Authentication**, activer le fournisseur **Google**.
4. Récupérer la **config Firebase web** (Paramètres du projet → Vos applications) pour
   renseigner les variables `VITE_FIREBASE_*` (voir plus bas).
5. Mettre à jour la **redirect URI** de l'application OSM OAuth si nécessaire.

> ⚠ Le rewrite de [firebase.json](firebase.json) cible un service Cloud Run nommé
> `osm-golf-api` en région `europe-west1`. Si vous changez ces valeurs au déploiement
> (`--service` / `--region`), éditez `firebase.json` en conséquence.

### Configuration (`deploy/.env`)

Les scripts chargent automatiquement `deploy/.env` (non versionné). Créez-le depuis le
modèle et renseignez les valeurs :

```bash
cp deploy/.env.example deploy/.env
# éditez deploy/.env : GEMINI_API_KEY, OSM_CLIENT_ID, OSM_CLIENT_SECRET,
# AUTHORIZED_EMAILS et les VITE_FIREBASE_* (config web Firebase)
```

### Scripts

Tous les scripts sont paramétrés (`--help`, aucune valeur en dur). Une fois `deploy/.env`
renseigné, tout enchaîner :

```bash
cd deploy
./deploy-all.sh --project osm-golf
```

Ou étape par étape :

```bash
cd deploy
./00-enable-apis.sh    --project osm-golf                                  # APIs GCP + projet
./40-provision-data.sh --project osm-golf                                  # Firestore + bucket + IAM
./10-secrets.sh        --project osm-golf                                  # secrets → Secret Manager
./20-deploy-backend.sh --project osm-golf [--region europe-west1] [--service osm-golf-api]  # Cloud Run
./45-deploy-firestore.sh --project osm-golf                                # règles/index Firestore + Storage
./30-deploy-frontend.sh --project osm-golf                                 # build + Hosting
```

## Authentification & habilitation

- **Connexion** : Google via Firebase Auth (obligatoire en production).
- **Habilitation** : allowlist d'emails (`AUTHORIZED_EMAILS`, CSV). *Fail-closed* — si la
  liste est vide, l'accès est refusé (403). « Être connecté » ne suffit pas : l'email doit
  figurer dans la liste.
- Le backend vérifie l'ID token Firebase (`Authorization: Bearer …`) sur **toutes** les
  routes `/api`. Le frontend attache automatiquement le token (helper `apiFetch`).

## Variables d'environnement & secrets

### Backend (Cloud Run — via Secret Manager, ou env local)

| Variable | Obligatoire | Description |
|---|---|---|
| `GEMINI_API_KEY` | Oui | Clé API Google Gemini (analyse des scorecards) |
| `OSM_CLIENT_ID` / `OSM_CLIENT_SECRET` | Écriture OSM | OAuth de l'application OpenStreetMap |
| `AUTHORIZED_EMAILS` | Oui (prod) | Emails habilités, séparés par des virgules |
| `FIREBASE_PROJECT_ID` | Auto (prod) | Projet Firebase pour la vérif de token + Firestore (posé par le script backend) |
| `DATA_BUCKET` | Couche données | Bucket Cloud Storage (géométries GeoJSON + scorecards ; posé par le script backend) |
| `AUTH_DISABLED` | Non | `1` désactive l'auth (dev local uniquement) |
| `CACHE_DIR` | Non | Dossier des caches disque (défaut `scripts/output`, `/tmp/osm-golf` en conteneur) |
| `PORT` | Non | Port du backend (défaut `3001` ; Cloud Run injecte `8080`) |

### Frontend (build — variables Vite, valeurs publiques)

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Config Firebase web |
| `VITE_FIREBASE_AUTH_DOMAIN` | `PROJECT_ID.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Identifiant du projet |
| `VITE_FIREBASE_APP_ID` | Identifiant de l'app web |

Laisser ces variables vides désactive l'auth côté frontend (comportement dev local).
Voir [frontend/.env.example](frontend/.env.example).

## API backend

Toutes les routes exigent un ID token Firebase valide (sauf en `AUTH_DISABLED=1`).

| Route | Description |
|---|---|
| `GET /api/search/name?q=…` | Recherche de golfs par nom (Overpass) |
| `GET /api/search/zone?lat=…&lng=…&radius=…` | Recherche par zone géographique |
| `GET /api/search/zone-stats?lat=…&lng=…&radius=…` | Stats de features OSM par golf (zone) |
| `GET /api/holes?osmId=…&lat=…&lng=…` | Trous OSM + analyse qualité pour un golf |
| `POST /api/holes/update-osm` | Report scorecard → OSM (aperçu ou écriture) |
| `POST /api/holes/assign-refs` | Affectation géométrique des ref/couleurs greens/tees |
| `GET /api/cgolf-holes?osmId=…` | Scorecard cgolf.fr matchée dynamiquement |
| `POST /api/cgolf-holes/analyze` | Analyse d'une scorecard image (Gemini Vision) |
| `*/api/osm-auth/*` | Flux OAuth OpenStreetMap (login/exchange/status) |
| `GET /api/base/health` | Health-check connectivité Firestore (couche données) |
| `POST /api/base/ingest` | Ingestion OSM d'un golf en base (`{osmId, lat, lng, name}`) |
| `POST /api/base/scorecard` | Décode + met en cache une scorecard (`{url\|fileData, osmId}`) |
| `GET /api/base/scorecards?osmId=…` | Scorecards en cache d'un golf (même non persisté) |
| `GET /api/base/scorecard/:id/image` | Image de scorecard stockée (proxy Storage) |

## Cache

Les caches disque (recherches Overpass, régions et matchs cgolf, scorecards analysées)
sont stockés dans `CACHE_DIR` : `scripts/output/` en local, `/tmp/osm-golf` sur Cloud Run.
Sur Cloud Run le système de fichiers est éphémère : les caches sont donc **volatils**
(perdus au redémarrage de l'instance), sans impact fonctionnel.

## Couche données (Firestore + Cloud Storage)

Persistance des golfs, parcours et scorecards. **Socle** (incrément ① : provisioning,
règles, module d'accès, health-check) + **ingestion OSM** (incrément ② : `POST /api/base/ingest`
→ upsert golf/parcours, provenance `osm`, geohash/nameIndex, géométries GeoJSON en Storage,
versioning par snapshot) + **scorecards** (incrément ③ : image en Storage + décodage + cache).
Merge multi-sources et branchement IHM suivent. Le backend est le **seul** client (Admin SDK) ;
les règles Firestore/Storage sont *deny-all*.

**Modèle** (hiérarchie) :

```
golfs/{golfId}                     # nom, localisation, geohash, osm:{type,id,ref}, nameIndex
  courses/{courseId}               # vue effective : holes[] à valeurs « emballées »
    versions/{n}                   # snapshots immuables (historique)
    sources/{sourceId}             # couches brutes (ex. dernier fetch OSM)
scorecards/{scorecardId}           # TOP-LEVEL : image (Storage) + décodage Gemini,
                                   #   lien souple osm.golfOsmId (peut exister sans golf
                                   #   persisté → cache d'affichage), coversCourses[] si associée
```

**Scorecards (cache)** — persistées **automatiquement à chaque décodage** (cgolf ou upload),
avec **dédup** par `scorecardId` déterministe (même image → pas de re-appel Gemini). La base
devient le cache (le FS Cloud Run est éphémère). En dev **sans émulateur**, `isBaseConfigured()`
est faux → repli sur le cache disque existant (non-breaking).

**Provenance** — chaque information atomique est *emballée* `{ v, src, at }` où `src`
identifie l'une des 4 origines : `osm`, `card-original:{id}`, `card-manual:{id}`, `manual`.
Les **géométries** (tracés, fairways, greens, tees, bunkers) sont stockées hors Firestore,
en **GeoJSON** dans Cloud Storage (une `FeatureCollection` par version), `properties`
portant `ref`/`color` emballés. Le vocabulaire (chemins + provenance) est centralisé dans
[backend/src/data/schema.js](backend/src/data/schema.js).

**Provisioning** : `deploy/40-provision-data.sh` (base Firestore + bucket + IAM) puis
`deploy/45-deploy-firestore.sh` (règles + index). Variables `deploy/.env` :
`FIRESTORE_LOCATION`, `DATA_BUCKET`, `BUCKET_LOCATION`.

**Développement local — émulateurs** (aucune credential, aucune écriture sur le vrai projet) :

```bash
# Terminal 1 — émulateurs Firestore + Storage (+ UI sur http://localhost:4000)
firebase emulators:start --only firestore,storage --project osm-golf

# Terminal 2 — backend pointé sur les émulateurs (l'Admin SDK détecte ces variables)
cd backend
AUTH_DISABLED=1 FIREBASE_PROJECT_ID=osm-golf DATA_BUCKET=osm-golf-data \
  FIRESTORE_EMULATOR_HOST=localhost:8080 STORAGE_EMULATOR_HOST=http://localhost:9199 \
  GEMINI_API_KEY=x npm run dev
```

Vérifs : `GET /api/base/health` → `{ ok:true, golfsEmpty:true }` ; puis ingérer un golf :

```bash
curl -X POST localhost:3001/api/base/ingest -H 'Content-Type: application/json' \
  -d '{"osmId":"way/…","lat":48.11,"lng":-1.20,"name":"Golf des Rochers Sévigné"}'
```

Contrôler dans l'UI émulateur : golf (`geohash`/`nameIndex`/`osm.ref`), `courses/{id}` (trous
emballés `{v,src:"osm",at}`, `version:1`, `geometryPath`), `versions/1`, et le GeoJSON en Storage.
Ré-ingestion à contenu identique → **pas** de nouvelle version.

`ingest` est une **voie d'amorçage opt-in** (import direct depuis OSM). Garde-fou 2-temps :
un parcours (ou un nom de golf) portant une information éditée (provenance ≠ `osm` :
`manual`/`card-*`) n'est **pas écrasé** — il est renvoyé `skipped:"protected"`. Ajouter
`"force":true` au corps pour forcer le réécrasement. La propagation des éditions locales
vers la base (2ᵉ temps) passera par un endpoint dédié + moteur de merge (incrément ultérieur).

En prod (Cloud Run), les identifiants (ADC) et `DATA_BUCKET` sont fournis par l'environnement ;
aucune variable d'émulateur n'est posée.

## Scripts Python (batch, optionnel)

`scripts/` contient des outils Python de correction/analyse OSM en masse (ex.
`add_course_tag.py`, `fix_golf_tee_tag.py`) et les sorties générées dans `scripts/output/`.
