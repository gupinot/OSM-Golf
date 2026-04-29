# OSM Golf Explorer

Outil web de diagnostic et de comparaison des données golf OpenStreetMap avec les scorecards officielles.

## Fonctionnalités

- **Recherche de golfs** par nom ou par zone géographique (ville ou géolocalisation, rayon 5–100 km)
- **Tableau de trous OSM** — données `golf=hole`, `golf=tee`, `golf=green` avec analyse qualité (refs manquants, doublons)
- **Comparaison visuelle OSM ↔ scorecard officielle** — matching automatique avec cgolf.fr, coloration cellule par cellule (rouge = absent, orange = divergent)
- **Analyse scorecard par IA** — lecture d'images de scorecards via Gemini Vision (URL ou fichier local)
- **Source personnalisée** — remplacement de la scorecard cgolf.fr par n'importe quelle image
- **Bouton "Éditer OSM"** — accès direct à l'éditeur OSM centré sur le golf sélectionné
- **Switch front/back** — inversion aller/retour sur la scorecard pour corriger les écarts d'ordre

## Architecture

```
OSM-Golf/
├── backend/        # Express (Node.js) — proxy Overpass, scraping cgolf.fr, analyse qualité
│   └── src/
│       ├── routes/ # search, holes, cgolf-holes, osm-auth
│       └── services/ # overpass, cgolf, quality, nominatim, osm-write
├── frontend/       # React + Vite
│   └── src/
│       ├── components/
│       └── services/
└── scripts/        # Scripts Python d'analyse OSM + sorties JSON/CSV
```

## Prérequis

- Node.js ≥ 18
- Clé API Gemini (`GEMINI_API_KEY`) — free tier suffisant

## Installation

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

## Démarrage

Lancer les deux processus dans des terminaux séparés :

```bash
# Terminal 1 — Backend (port 3001)
cd backend
GEMINI_API_KEY=<votre_clé> npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

L'application est accessible sur [http://localhost:5173](http://localhost:5173).

Le frontend proxy les requêtes `/api/*` vers le backend `http://localhost:3001`.

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `GEMINI_API_KEY` | Oui | Clé API Google Gemini pour l'analyse des scorecards |
| `PORT` | Non | Port du backend (défaut : `3001`) |
| `DEBUG` | Non | Mettre `osm-golf` pour activer les logs détaillés |

## API backend

| Route | Description |
|---|---|
| `GET /api/search/name?q=…` | Recherche de golfs par nom (Overpass) |
| `GET /api/search/zone?lat=…&lng=…&radius=…` | Recherche par zone géographique |
| `GET /api/holes?osmId=…&osmType=…` | Trous OSM + analyse qualité pour un golf |
| `GET /api/cgolf-holes?osmId=…` | Scorecard cgolf.fr matchée dynamiquement |
| `POST /api/cgolf-holes/analyze` | Analyse d'une scorecard image (Gemini Vision) |

## Scripts d'analyse (Python)

Situés dans `scripts/`, utilisés pour le diagnostic qualité OSM en batch :

```bash
python scripts/analyze_osm_cgolf.py   # Comparaison OSM ↔ cgolf.fr
python scripts/add_course_tag.py      # Ajout du tag course manquant
python scripts/fix_golf_tee_tag.py    # Correction des tags golf=tee
```

Les sorties JSON/CSV sont générées dans `scripts/output/`.

## Cache

Le backend maintient deux fichiers de cache dans `scripts/output/` :

- `cgolf_regions_cache.json` — parcours cgolf.fr par région (scraping)
- `cgolf_match_cache.json` — résultats de matching OSM ↔ cgolf par `osmId`
