#!/usr/bin/env python3
"""
Analyse croisée OSM vs cgolf.fr — parcours de golf dans un rayon de 100 km.

Étapes :
  1. fetch_osm_courses      — Overpass API : liste des parcours OSM
  2. fetch_cgolf_courses    — Scraping pages régionales cgolf.fr (markers JS + liens /detail/)
  3. analyze_scorecard      — Téléchargement image JPEG + analyse Claude vision
  4. main                   — Orchestration, matching fuzzy, tableau + CSV

Approche cgolf.fr :
  - Pages /parcours/golfs-{region} contiennent un array JS "var markers = [name, lat, lng]"
    et les liens /detail/{slug} correspondants (même ordre).
  - La scorecard de chaque parcours est une image JPEG directe :
    https://www.cgolf.fr/gallery/parcours/{ID}.jpg
  - Pas de Playwright nécessaire : tout se fait avec requests.

Usage :
  # Dry-run (OSM + cgolf listing, sans analyse image)
  python analyze_osm_cgolf.py --dry-run

  # Analyse complète
  python analyze_osm_cgolf.py --api-key sk-ant-...

  # Paramètres optionnels
  python analyze_osm_cgolf.py --lat 45.764 --lng 4.835 --radius 100 --api-key sk-ant-...

Dépendances :
  pip install requests beautifulsoup4 anthropic rapidfuzz
"""

import argparse
import base64
import csv
from collections import Counter
import json
import math
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_LAT    = 45.7640   # Lyon
DEFAULT_LNG    = 4.8357
DEFAULT_RADIUS = 100       # km

OUTPUT_DIR = Path(__file__).parent / "output"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
OVERPASS_MAX_RETRIES   = 3
OVERPASS_RETRY_DELAY_S = 5

CGOLF_BASE_URL = "https://www.cgolf.fr"

# Régions cgolf.fr à couvrir pour un rayon de 100 km autour de Lyon
CGOLF_REGIONS = [
    "/parcours/golfs-rhone-alpes",
    "/parcours/golfs-auvergne",
    "/parcours/golfs-bourgogne",
    "/parcours/golfs-franche-comte",
]

# Seuil fuzzy (0-100) pour matcher un parcours OSM avec un parcours cgolf
FUZZY_THRESHOLD = 60
# Seuil géographique de matching de secours (km) — deux clubs < 3 km → même site
GEO_THRESHOLD_KM = 3.0
# Distance max autorisée entre un match fuzzy et l'entrée OSM (km).
# Évite de matcher "Golf Club de Lyon" avec des clubs qui ont juste "Lyon" dans le nom
# mais sont géographiquement loin (club différent).
MAX_GEO_FOR_FUZZY_KM = 10.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance en km entre deux points GPS."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def normalize_name(name: str) -> str:
    """Normalise un nom pour la comparaison fuzzy."""
    if not name:
        return ""
    nfkd = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in nfkd if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^\w\s]", " ", s)
    stop = {
        "golf", "club", "de", "du", "le", "la", "les", "l", "d", "des",
        "et", "en", "au", "aux", "sur", "parcours", "course",
    }
    return " ".join(t for t in s.split() if t not in stop)


def _overpass_post(query: str) -> dict:
    """Envoie une requête Overpass avec retry et failover d'endpoint."""
    last_exc: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, OVERPASS_MAX_RETRIES + 1):
            try:
                print(f"  Tentative {attempt}/{OVERPASS_MAX_RETRIES} → {endpoint}")
                resp = requests.post(endpoint, data={"data": query}, timeout=60)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                last_exc = exc
                print(f"  Échec : {exc}")
                if attempt < OVERPASS_MAX_RETRIES:
                    print(f"  Nouvelle tentative dans {OVERPASS_RETRY_DELAY_S}s...")
                    time.sleep(OVERPASS_RETRY_DELAY_S)
        print("  Endpoint épuisé, passage au suivant...\n")
    raise RuntimeError(f"Tous les endpoints Overpass ont échoué. Dernière erreur : {last_exc}")


def _make_slug(name: str) -> str:
    """Génère un slug URL-safe depuis un nom (max 50 chars)."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    s = re.sub(r"[^\w]", "-", ascii_str.lower())
    return re.sub(r"-+", "-", s).strip("-")[:50]


# ---------------------------------------------------------------------------
# Fonction 1 — OSM
# ---------------------------------------------------------------------------

def fetch_osm_courses(
    lat: float = DEFAULT_LAT,
    lng: float = DEFAULT_LNG,
    radius_km: float = DEFAULT_RADIUS,
) -> list[dict]:
    """
    Récupère via Overpass API tous les parcours de golf dans un rayon donné.

    Retourne une liste de dicts triés par distance :
    {osm_id, name, city, lat, lng, distance_km, holes}
    """
    radius_m = int(radius_km * 1000)
    query = f"""
[out:json][timeout:60];
(
  way["leisure"="golf_course"](around:{radius_m},{lat},{lng});
  relation["leisure"="golf_course"](around:{radius_m},{lat},{lng});
);
out center tags;
"""
    print(f"\n── Étape 1 : Overpass API (rayon {radius_km} km autour de {lat}, {lng})...")
    data = _overpass_post(query)
    elements = data.get("elements", [])
    print(f"  → {len(elements)} éléments reçus")

    courses = []
    for e in elements:
        tags = e.get("tags", {})
        name = tags.get("name", "").strip()
        if not name:
            continue

        if "center" in e:
            clat, clng = e["center"]["lat"], e["center"]["lon"]
        elif "lat" in e:
            clat, clng = e["lat"], e["lon"]
        else:
            continue

        osm_id  = f"{e['type']}/{e['id']}"
        city    = (tags.get("addr:city") or tags.get("is_in:city") or "").strip()
        holes_raw = tags.get("holes") or tags.get("golf:holes") or ""
        try:
            holes = int(holes_raw)
        except (ValueError, TypeError):
            holes = None

        courses.append({
            "osm_id":      osm_id,
            "name":        name,
            "city":        city,
            "lat":         clat,
            "lng":         clng,
            "distance_km": round(haversine(lat, lng, clat, clng), 1),
            "holes":       holes,
        })

    courses.sort(key=lambda c: c["distance_km"])
    print(f"  → {len(courses)} parcours avec nom")
    return courses


# ---------------------------------------------------------------------------
# Fonction 2 — cgolf.fr : pages régionales
# ---------------------------------------------------------------------------

def _get_detail_urls_from_region(region_path: str) -> list[str]:
    """
    Récupère la liste de tous les liens /detail/ d'une page régionale cgolf.fr.
    """
    url = CGOLF_BASE_URL + region_path
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"  ERREUR chargement {url} : {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    hrefs = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=re.compile(r"^/detail/")):
        href = a["href"]
        if href not in seen:
            seen.add(href)
            hrefs.append(CGOLF_BASE_URL + href)
    return hrefs


def _fetch_detail_info(detail_url: str) -> dict | None:
    """
    Visite une page /detail/ cgolf.fr et extrait :
    - name  : nom du parcours (titre de la page ou h1)
    - lat, lng : coordonnées GPS depuis le Leaflet JS
    - scorecard_img_url : URL de l'image scorecard (/gallery/parcours/{ID}.jpg)

    Retourne None en cas d'erreur.
    """
    try:
        resp = requests.get(detail_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"    ERREUR {detail_url} : {e}")
        return None

    html = resp.text

    # GPS depuis Leaflet : var target = L.latLng('45.895719', 4.966835);
    gps = re.search(r"L\.latLng\(['\"]?([\d.]+)['\"]?\s*,\s*['\"]?([\d.]+)['\"]?\)", html)
    if not gps:
        return None
    lat, lng = float(gps.group(1)), float(gps.group(2))

    # Nom : depuis le <title> de la page
    # Patterns cgolf.fr observés :
    #   "Score du Garden Golf Mionnay | Cgolf.fr"
    #   "Score de la Golf de La Sorelle | Cgolf.fr"
    #   "Golf de Miribel-Jonage Vaulx-En-Velin (69)... - Cgolf"
    soup = BeautifulSoup(html, "html.parser")
    name = ""
    title_tag = soup.find("title")
    if title_tag:
        title_text = title_tag.get_text(strip=True)
        # Supprime préfixe "Score du/de la/de l'/des " et suffixe " | Cgolf..." ou " - Cgolf..."
        m = re.match(r"Score\s+(?:du|de\s+la|de\s+l'|des?)\s+(.+?)(?:\s*[\|–-]\s*Cgolf.*)?$",
                     title_text, re.IGNORECASE)
        if m:
            name = m.group(1).strip()
        else:
            # Supprime juste le suffixe Cgolf
            name = re.sub(r"\s*[\|–-]\s*Cgolf.*$", "", title_text, flags=re.IGNORECASE).strip()
            # Supprime la partie localisation entre parenthèses ou après une virgule
            name = re.sub(r"\s*\(\d+\).*$", "", name).strip()

    # Fallback : titre depuis h2 "CARACTÉRISTIQUES ET CARTE DE SCORE DU ..."
    if not name:
        for tag in soup.find_all(["h1", "h2", "h3"]):
            text = tag.get_text(strip=True)
            m = re.search(r"carte\s+de\s+score\s+du\s+(.+)", text, re.IGNORECASE)
            if m:
                name = m.group(1).strip().title()
                break

    # Fallback final : reconstruit depuis le slug URL
    if not name:
        slug = detail_url.split("/detail/")[-1]
        slug = re.sub(r"-\d{5}[a-z]?$", "", slug)  # supprime code postal
        name = slug.replace("-", " ").title()

    # URL image scorecard
    m_img = re.search(r"gallery/parcours/(\d+)\.jpg", html)
    scorecard_img_url = f"{CGOLF_BASE_URL}/gallery/parcours/{m_img.group(1)}.jpg" if m_img else None

    return {
        "name":             name,
        "lat":              lat,
        "lng":              lng,
        "scorecard_img_url": scorecard_img_url,
    }


def fetch_cgolf_courses(
    ref_lat: float = DEFAULT_LAT,
    ref_lng: float = DEFAULT_LNG,
    radius_km: float = DEFAULT_RADIUS,
    regions: list[str] = CGOLF_REGIONS,
) -> list[dict]:
    """
    Récupère tous les parcours cgolf.fr des régions données.

    Stratégie :
    1. Collecte toutes les URLs /detail/ depuis les pages régionales.
    2. Pour chaque URL, visite la page de détail pour extraire nom et GPS.
    3. Filtre par distance depuis le point de référence.

    Retourne une liste de dicts triée par distance :
    {name, lat, lng, url, region, distance_km, scorecard_img_url}
    """
    print(f"\n── Étape 2 : Scraping cgolf.fr ({len(regions)} régions)...")

    # ── Collecte des URLs /detail/ ────────────────────────────────────────
    all_urls: list[tuple[str, str]] = []  # (url, region_label)
    seen_urls: set[str] = set()
    for region in regions:
        print(f"  → {region}", end="", flush=True)
        hrefs = _get_detail_urls_from_region(region)
        region_label = region.split("golfs-")[-1]
        added = 0
        for url in hrefs:
            if url not in seen_urls:
                seen_urls.add(url)
                all_urls.append((url, region_label))
                added += 1
        print(f" ({added} liens)")
        time.sleep(0.3)

    print(f"  → {len(all_urls)} parcours uniques — récupération des infos de chaque page...")

    # ── Visite de chaque page /detail/ ───────────────────────────────────
    all_courses: list[dict] = []
    for i, (url, region_label) in enumerate(all_urls):
        info = _fetch_detail_info(url)
        if info is None:
            continue
        dist = haversine(ref_lat, ref_lng, info["lat"], info["lng"])
        if dist <= radius_km:
            all_courses.append({
                "name":             info["name"],
                "lat":              info["lat"],
                "lng":              info["lng"],
                "url":              url,
                "region":           region_label,
                "distance_km":      round(dist, 1),
                "scorecard_img_url": info["scorecard_img_url"],
            })
        if (i + 1) % 10 == 0:
            print(f"    {i + 1}/{len(all_urls)} pages visitées ({len(all_courses)} dans le rayon)...")
        time.sleep(0.4)  # politesse

    all_courses.sort(key=lambda c: c["distance_km"])
    print(f"  → {len(all_courses)} parcours dans le rayon de {radius_km} km")
    return all_courses


# ---------------------------------------------------------------------------
# Fonction 3 — Scorecard : image JPEG + Claude vision
# ---------------------------------------------------------------------------

def _get_scorecard_image_url(detail_url: str) -> str | None:
    """
    Visite la page /detail/ d'un parcours et retourne l'URL de l'image scorecard.
    Pattern : https://www.cgolf.fr/gallery/parcours/{ID}.jpg
    """
    try:
        resp = requests.get(detail_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"    Erreur accès {detail_url} : {e}")
        return None

    # Cherche l'image scorecard dans le HTML
    m = re.search(r'gallery/parcours/(\d+)\.jpg', resp.text)
    if m:
        return f"{CGOLF_BASE_URL}/gallery/parcours/{m.group(1)}.jpg"

    # Fallback : cherche toute image /gallery/parcours/
    soup = BeautifulSoup(resp.text, "html.parser")
    for img in soup.find_all("img", src=re.compile(r"/gallery/parcours/")):
        src = img["src"]
        return src if src.startswith("http") else CGOLF_BASE_URL + src

    return None


def _download_image(image_url: str, dest_path: Path) -> bool:
    """Télécharge une image et la sauvegarde. Retourne True si OK."""
    try:
        resp = requests.get(image_url, headers=HEADERS, timeout=20, stream=True)
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"    Erreur téléchargement {image_url} : {e}")
        return False


def _analyze_image_with_claude(image_path: Path, api_key: str) -> list[dict] | None:
    """
    Envoie l'image scorecard à Claude Haiku (vision) et retourne les données JSON.
    """
    try:
        import anthropic
    except ImportError:
        print("  ERREUR : anthropic non installé. `pip install anthropic`")
        return None

    # Détecte le type MIME
    suffix = image_path.suffix.lower()
    media_type = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png"

    try:
        with open(image_path, "rb") as f:
            img_b64 = base64.standard_b64encode(f.read()).decode("utf-8")
    except Exception as e:
        print(f"    Lecture image impossible {image_path} : {e}")
        return None

    client = anthropic.Anthropic(api_key=api_key)

    prompt = (
        "Voici la carte de score d'un parcours de golf. "
        "Extrais les données trou par trou et retourne UNIQUEMENT un JSON valide, "
        "sans texte supplémentaire, sous cette forme exacte :\n"
        "[\n"
        '  {"hole": 1, "par": 4, "handicap": 5, '
        '"distances": {"black": 378, "white": 378, "yellow": 369, "blue": 312, "red": 307}},\n'
        "  ...\n"
        "]\n"
        "Utilise null pour les valeurs absentes. "
        "Colonnes françaises → clés JSON : "
        "Trou=hole, Par=par, Hcp=handicap, "
        "Noire=black, Blanc=white, Jaune=yellow, Bleu=blue, Rouge=red. "
        "Ignore les lignes Aller/Retour/Total/SSS/Slope."
    )

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": img_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        raw = message.content[0].text.strip()
        # Extrait le JSON si entouré de code fences
        fence = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", raw, re.DOTALL)
        if fence:
            raw = fence.group(1)
        return json.loads(raw)
    except Exception as e:
        print(f"    Analyse Claude échouée : {e}")
        return None


def analyze_scorecard(course_url: str, course_name: str, api_key: str, scorecard_img_url: str | None = None) -> list[dict] | None:
    """
    Télécharge la scorecard JPEG d'un parcours cgolf.fr et l'analyse avec Claude.
    Sauvegarde le JPEG et le JSON dans scripts/output/.
    Retourne la liste structurée des trous.
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    slug      = _make_slug(course_name)
    img_path  = OUTPUT_DIR / f"scorecard_{slug}.jpg"
    json_path = OUTPUT_DIR / f"cgolf_{slug}.json"

    # Récupère l'URL de l'image (depuis cgolf_courses si déjà disponible)
    print(f"  → Récupération scorecard : {course_url}")
    img_url = scorecard_img_url or _get_scorecard_image_url(course_url)
    if not img_url:
        print("    ✗ Image scorecard introuvable")
        return None

    # Télécharge si pas déjà en cache
    if not img_path.exists():
        print(f"    ↓ Téléchargement : {img_url}")
        if not _download_image(img_url, img_path):
            return None
    else:
        print(f"    ✓ Cache : {img_path.name}")

    # Analyse Claude vision
    print(f"    🔍 Analyse Claude vision...")
    holes_data = _analyze_image_with_claude(img_path, api_key)

    if holes_data:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(holes_data, f, ensure_ascii=False, indent=2)
        print(f"    ✓ {len(holes_data)} trous extraits → {json_path.name}")
    else:
        print("    ✗ Extraction échouée")

    return holes_data


# ---------------------------------------------------------------------------
# Matching OSM ↔ cgolf
# ---------------------------------------------------------------------------

def match_courses(
    osm_courses: list[dict],
    cgolf_courses: list[dict],
) -> list[dict]:
    """
    Pour chaque parcours OSM, cherche TOUS les parcours cgolf correspondants.
    Un golf OSM peut avoir plusieurs parcours cgolf (ex: Golf du Gouverneur → Le Breuil + Montaplan).
    Chaque match produit une ligne séparée dans les résultats.
    Stratégie : fuzzy sur noms normalisés, fallback géographique.
    """
    results = []
    for osm in osm_courses:
        osm_norm = normalize_name(osm["name"])
        matches: list[tuple[int, dict]] = []

        for cgolf in cgolf_courses:
            score = fuzz.token_set_ratio(osm_norm, normalize_name(cgolf["name"]))
            geo_dist = haversine(osm["lat"], osm["lng"], cgolf["lat"], cgolf["lng"])

            if score >= FUZZY_THRESHOLD and geo_dist <= MAX_GEO_FOR_FUZZY_KM:
                # Match fuzzy ET géographiquement cohérent
                matches.append((score, cgolf))
            elif geo_dist <= GEO_THRESHOLD_KM:
                # Match accepté par proximité géo pure (< 3 km) — score minimum
                matches.append((FUZZY_THRESHOLD, cgolf))

        if matches:
            # Dédoublonne (au cas où un parcours serait accepté à la fois par fuzzy et géo)
            seen_urls: set[str] = set()
            unique_matches: list[tuple[int, dict]] = []
            for score, cgolf in sorted(matches, key=lambda x: -x[0]):
                if cgolf["url"] not in seen_urls:
                    seen_urls.add(cgolf["url"])
                    unique_matches.append((score, cgolf))

            for score, cgolf in unique_matches:
                results.append({
                    **osm,
                    "cgolf_found":             True,
                    "cgolf_name":              cgolf["name"],
                    "cgolf_url":               cgolf["url"],
                    "cgolf_lat":               cgolf["lat"],
                    "cgolf_lng":               cgolf["lng"],
                    "cgolf_scorecard_img_url": cgolf.get("scorecard_img_url"),
                    "match_score":             score,
                    "scorecard_data":          None,
                })
        else:
            # Aucun match — une ligne avec cgolf_found=False
            results.append({
                **osm,
                "cgolf_found":             False,
                "cgolf_name":              "",
                "cgolf_url":               "",
                "cgolf_lat":               None,
                "cgolf_lng":               None,
                "cgolf_scorecard_img_url": None,
                "match_score":             0,
                "scorecard_data":          None,
            })

    return results


# ---------------------------------------------------------------------------
# Fonction 5 — Contrôle qualité OSM des trous
# ---------------------------------------------------------------------------

def fetch_osm_holes(lat: float, lng: float, radius_km: float = 5.0) -> list[dict]:
    """
    Récupère via Overpass API tous les way[golf=hole] dans un rayon autour d'un golf.

    Retourne une liste de dicts :
    {osm_way_id, ref, course, par, handicap, dist_tags: {tag: valeur}}
    """
    radius_m = int(radius_km * 1000)
    query = f"""
[out:json][timeout:30];
way["golf"="hole"](around:{radius_m},{lat},{lng});
out tags;
"""
    data = _overpass_post(query)
    holes = []
    for e in data.get("elements", []):
        tags = e.get("tags", {})
        dist_tags = {k: v for k, v in tags.items() if k.startswith("dist:")}
        holes.append({
            "osm_way_id": e["id"],
            "ref":        tags.get("ref", "").strip(),
            "course":     tags.get("course", "").strip(),
            "par":        tags.get("par", "").strip(),
            "handicap":   tags.get("handicap", "").strip(),
            "dist_tags":  dist_tags,
        })
    return holes


def _hole_sort_key(h: dict):
    ref = h.get("ref", "")
    try:
        return (0, int(ref), "")
    except (ValueError, TypeError):
        return (1, 0, ref or "")


def analyze_holes_quality(holes: list[dict]) -> dict:
    """
    Analyse la qualité des tags OSM pour un ensemble de trous d'un golf.

    Logique :
    - Regroupe les trous par tag 'course' (chaîne vide si absent).
    - Par groupe : détecte les trous sans 'ref' et les 'ref' en doublon.
    - Un golf est 'valid' si tous les groupes ont des refs complètes et uniques.

    Retourne :
    {
      valid: bool,
      total_holes: int,
      missing_ref_count: int,
      unresolved_duplicates: int,   # nb de valeurs ref en doublon (toutes courses confondues)
      courses: {
        "course_name": {
          holes: [... triés par ref],
          missing_ref_count: int,
          duplicate_refs: ["1", ...]
        }
      }
    }
    """
    if not holes:
        return {
            "valid": False, "total_holes": 0,
            "missing_ref_count": 0, "unresolved_duplicates": 0,
            "courses": {},
        }

    # Regroupe par tag 'course'
    groups: dict[str, list[dict]] = {}
    for h in holes:
        key = h["course"] or ""
        groups.setdefault(key, []).append(h)

    total_missing = 0
    total_dupes   = 0
    courses_out: dict[str, dict] = {}

    for course_key, grp in groups.items():
        missing    = sum(1 for h in grp if not h["ref"])
        ref_counts = Counter(h["ref"] for h in grp if h["ref"])
        dupes      = [r for r, cnt in ref_counts.items() if cnt > 1]

        total_missing += missing
        total_dupes   += len(dupes)

        courses_out[course_key] = {
            "holes":             sorted(grp, key=_hole_sort_key),
            "missing_ref_count": missing,
            "duplicate_refs":    dupes,
        }

    return {
        "valid":                  (total_missing == 0 and total_dupes == 0),
        "total_holes":            len(holes),
        "missing_ref_count":      total_missing,
        "unresolved_duplicates":  total_dupes,
        "courses":                courses_out,
    }


def print_holes_quality_report(analyses: dict) -> None:
    """Affiche le rapport qualité OSM des trous en console."""
    invalid = {k: v for k, v in analyses.items() if not v["valid"]}
    valid   = {k: v for k, v in analyses.items() if v["valid"]}

    W = 72
    # ── Golfs invalides ───────────────────────────────────────────────────
    print("\n" + "═" * W)
    print(f"  GOLFS INVALIDES ({len(invalid)}) — tags OSM incomplets")
    print("─" * W)
    if invalid:
        print(f"  {'Golf':<35} {'Trous':>6}  {'Sans ref':>8}  {'Doublons':>8}")
        print("  " + "─" * (W - 2))
        for _, a in sorted(invalid.items(), key=lambda x: x[1]["golf_name"]):
            print(
                f"  {a['golf_name']:<35.35} {a['total_holes']:>6}"
                f"  {a['missing_ref_count']:>8}  {a['unresolved_duplicates']:>8}"
            )
    else:
        print("  (aucun)")
    print("═" * W)

    # ── Golfs valides — détail par trou ───────────────────────────────────
    print(f"\n{'═' * W}")
    print(f"  GOLFS VALIDES ({len(valid)}) — détail par trou")

    for _, a in sorted(valid.items(), key=lambda x: x[1]["golf_name"]):
        city = a.get("golf_city", "")
        print(f"\n{'═' * W}")
        print(f"  Golf : {a['golf_name']}" + (f"  ({city})" if city else ""))

        for course_key, cd in sorted(a["courses"].items()):
            if course_key:
                print(f"\n  ── Parcours : {course_key}")

            # Colonnes dist:* présentes sur ce parcours
            all_dist = sorted({dk for h in cd["holes"] for dk in h["dist_tags"]})
            colors   = [dk.replace("dist:", "") for dk in all_dist]

            hdr = f"    {'Ref':>4}  {'Par':>3}  {'Hcp':>3}"
            for c in colors:
                hdr += f"  {c:>8}"
            print(hdr)
            print("    " + "─" * max(0, len(hdr) - 4))

            for h in cd["holes"]:
                row = f"    {h['ref']:>4}  {h['par']:>3}  {h['handicap']:>3}"
                for dk in all_dist:
                    row += f"  {h['dist_tags'].get(dk, ''):>8}"
                print(row)

    print("═" * W)


def save_holes_quality_report(analyses: dict) -> None:
    """Sauvegarde le rapport qualité en JSON et deux CSV (invalides / valides)."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── JSON complet ──────────────────────────────────────────────────────
    json_path = OUTPUT_DIR / "holes_quality_report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(analyses, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Rapport JSON     : {json_path}")

    # ── CSV invalides ─────────────────────────────────────────────────────
    invalid_rows = [
        {
            "golf_name":             v["golf_name"],
            "golf_city":             v.get("golf_city", ""),
            "osm_id":                k,
            "total_holes":           v["total_holes"],
            "missing_ref_count":     v["missing_ref_count"],
            "unresolved_duplicates": v["unresolved_duplicates"],
        }
        for k, v in sorted(analyses.items(), key=lambda x: x[1]["golf_name"])
        if not v["valid"]
    ]
    if invalid_rows:
        csv_path = OUTPUT_DIR / "holes_invalid_report.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(invalid_rows[0].keys()))
            writer.writeheader()
            writer.writerows(invalid_rows)
        print(f"✓ CSV invalides    : {csv_path}")

    # ── CSV valides ───────────────────────────────────────────────────────
    # Single pass: collect dist keys and build rows simultaneously
    all_dist_keys: set[str] = set()
    valid_rows: list[dict] = []
    for k, v in sorted(analyses.items(), key=lambda x: x[1]["golf_name"]):
        if not v["valid"]:
            continue
        for course_key, cd in sorted(v["courses"].items()):
            for h in cd["holes"]:
                all_dist_keys.update(h["dist_tags"].keys())
                valid_rows.append({
                    "golf_name": v["golf_name"],
                    "golf_city": v.get("golf_city", ""),
                    "osm_id":    k,
                    "course":    course_key,
                    "ref":       h["ref"],
                    "par":       h["par"],
                    "handicap":  h["handicap"],
                    "_dist_tags": h["dist_tags"],
                })
    all_dist_cols = sorted(all_dist_keys)
    # Fill dist columns now that all keys are known
    for row in valid_rows:
        dist_tags = row.pop("_dist_tags")
        for dk in all_dist_cols:
            row[dk] = dist_tags.get(dk, "")

    if valid_rows:
        csv_path  = OUTPUT_DIR / "holes_valid_report.csv"
        fieldnames = ["golf_name", "golf_city", "osm_id", "course",
                      "ref", "par", "handicap"] + all_dist_cols
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(valid_rows)
        print(f"✓ CSV valides      : {csv_path}")


def check_holes_mode(args) -> None:
    """
    Mode --check-holes : charge match_results.json depuis le cache et analyse
    la qualité des trous OSM pour chaque golf matché.

    Les trous sont mis en cache par golf (osm_holes_{id}.json) pour éviter
    de ré-interroger Overpass à chaque exécution.
    """
    match_path = OUTPUT_DIR / "match_results.json"
    if not match_path.exists():
        print(f"ERREUR : {match_path} introuvable.")
        print("Lancez d'abord le script sans --check-holes pour générer le fichier de matching.")
        sys.exit(1)

    with open(match_path, encoding="utf-8") as f:
        results = json.load(f)

    # Dédoublonne par osm_id (un golf OSM → plusieurs lignes cgolf possibles)
    seen: dict[str, dict] = {}
    for r in results:
        if r["cgolf_found"] and r["osm_id"] not in seen:
            seen[r["osm_id"]] = r
    matched = list(seen.values())

    print(f"\n── Mode check-holes : {len(matched)} golfs OSM matchés à analyser")
    print(f"   Rayon Overpass par golf : 5 km\n")

    analyses: dict[str, dict] = {}

    for i, r in enumerate(matched, 1):
        osm_id     = r["osm_id"]
        safe_id    = osm_id.replace("/", "_")
        cache_path = OUTPUT_DIR / f"osm_holes_{safe_id}.json"

        print(f"  [{i:>2}/{len(matched)}] {r['name']}", end="", flush=True)

        if cache_path.exists():
            with open(cache_path, encoding="utf-8") as f:
                holes = json.load(f)
            print(f" — {len(holes)} trous (cache)")
        else:
            holes = fetch_osm_holes(r["lat"], r["lng"], radius_km=5.0)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(holes, f, ensure_ascii=False, indent=2)
            print(f" — {len(holes)} trous")
            time.sleep(0.5)  # politesse Overpass

        analyses[osm_id] = {
            "golf_name": r["name"],
            "golf_city": r.get("city", ""),
            **analyze_holes_quality(holes),
        }

    print_holes_quality_report(analyses)
    save_holes_quality_report(analyses)


# ---------------------------------------------------------------------------
# Fonction 4 — Orchestration + rapport
# ---------------------------------------------------------------------------

def _scorecard_summary(holes: list[dict] | None) -> dict:
    if not holes:
        return {"holes_count": 0, "has_par": False, "has_hcp": False, "has_dist": False}
    has_par  = any(h.get("par")      for h in holes)
    has_hcp  = any(h.get("handicap") for h in holes)
    has_dist = any(h.get("distances") and any(v for v in h["distances"].values() if v) for h in holes)
    return {"holes_count": len(holes), "has_par": has_par, "has_hcp": has_hcp, "has_dist": has_dist}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyse croisée OSM vs cgolf.fr — parcours dans un rayon donné"
    )
    parser.add_argument("--lat",          type=float, default=DEFAULT_LAT)
    parser.add_argument("--lng",          type=float, default=DEFAULT_LNG)
    parser.add_argument("--radius",       type=float, default=DEFAULT_RADIUS,
                        help="Rayon de recherche en km (défaut 100)")
    parser.add_argument("--api-key",      type=str,   default=os.environ.get("ANTHROPIC_API_KEY", ""),
                        help="Clé API Anthropic (ou var ANTHROPIC_API_KEY)")
    parser.add_argument("--dry-run",      action="store_true",
                        help="Liste OSM + cgolf sans analyse image Claude")
    parser.add_argument("--max-analyze",  type=int,   default=999,
                        help="Nombre max de scorecards à analyser (limite les coûts API)")
    parser.add_argument("--check-holes",  action="store_true",
                        help="Analyse qualité OSM des trous (charge match_results.json existant)")
    args = parser.parse_args()

    # ── Mode check-holes standalone ───────────────────────────────────────
    if args.check_holes:
        check_holes_mode(args)
        return

    if not args.dry_run and not args.api_key:
        print("ERREUR : --api-key requis hors dry-run (ou variable ANTHROPIC_API_KEY).")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── 1. OSM ────────────────────────────────────────────────────────────────
    osm_courses = fetch_osm_courses(args.lat, args.lng, args.radius)
    with open(OUTPUT_DIR / "osm_courses.json", "w", encoding="utf-8") as f:
        json.dump(osm_courses, f, ensure_ascii=False, indent=2)
    print(f"  ✓ osm_courses.json — {len(osm_courses)} parcours")

    # ── 2. cgolf.fr ───────────────────────────────────────────────────────────
    cgolf_courses = fetch_cgolf_courses(args.lat, args.lng, args.radius)
    with open(OUTPUT_DIR / "cgolf_courses.json", "w", encoding="utf-8") as f:
        json.dump(cgolf_courses, f, ensure_ascii=False, indent=2)
    print(f"  ✓ cgolf_courses.json — {len(cgolf_courses)} parcours")

    # ── 3. Matching OSM ↔ cgolf ───────────────────────────────────────────────
    print("\n── Étape 3 : Matching OSM ↔ cgolf.fr...")
    results = match_courses(osm_courses, cgolf_courses)
    osm_matched = len({r["osm_id"] for r in results if r["cgolf_found"]})
    total_rows   = sum(1 for r in results if r["cgolf_found"])
    print(f"  → {osm_matched}/{len(osm_courses)} parcours OSM matchés ({total_rows} lignes au total)")

    # Sauvegarde pour --check-holes (scorecard_data exclue = non sérialisable proprement)
    match_path = OUTPUT_DIR / "match_results.json"
    serializable = [{k: v for k, v in r.items() if k != "scorecard_data"} for r in results]
    with open(match_path, "w", encoding="utf-8") as f:
        json.dump(serializable, f, ensure_ascii=False, indent=2)
    print(f"  ✓ match_results.json — {len(results)} lignes")

    # ── 4. Analyse scorecard ──────────────────────────────────────────────────
    if not args.dry_run:
        print(f"\n── Étape 4 : Analyse scorecard (max {args.max_analyze})...")
        analyzed = 0
        for r in results:
            if not r["cgolf_found"]:
                continue
            if analyzed >= args.max_analyze:
                break
            r["scorecard_data"] = analyze_scorecard(
                r["cgolf_url"], r["cgolf_name"], args.api_key,
                scorecard_img_url=r.get("cgolf_scorecard_img_url"),
            )
            analyzed += 1
            time.sleep(0.5)

    # ── 5. Tableau console ────────────────────────────────────────────────────
    W = 110
    print("\n" + "═" * W)
    print(f"{'OSM Name':<35} {'Ville':<18} {'Dist':>5}  {'cgolf':>5} {'Sc':>3}  {'cgolf Name':<35} {'Tr':>3} {'Pa':>3} {'Hc':>3} {'Di':>3}")
    print("─" * W)

    csv_rows = []
    for r in results:
        sc  = _scorecard_summary(r.get("scorecard_data"))
        fnd = "✓" if r["cgolf_found"] else "✗"
        score_s = f"{int(r['match_score']):3d}" if r["cgolf_found"] else "  -"

        def yn(val: bool, found: bool) -> str:
            return "✓" if val else ("?" if found else "-")

        cgolf_display = r.get("cgolf_name", "")
        print(
            f"{r['name']:<35.35} "
            f"{r['city']:<18.18} "
            f"{r['distance_km']:>4.1f}  "
            f"{fnd:>5} "
            f"{score_s:>3}  "
            f"{cgolf_display:<35.35} "
            f"{sc['holes_count'] or '':>3} "
            f"{yn(sc['has_par'],  r['cgolf_found']):>3} "
            f"{yn(sc['has_hcp'],  r['cgolf_found']):>3} "
            f"{yn(sc['has_dist'], r['cgolf_found']):>3}"
        )

        csv_rows.append({
            "osm_name":    r["name"],
            "osm_city":    r["city"],
            "osm_id":      r["osm_id"],
            "distance_km": r["distance_km"],
            "cgolf_found": "oui" if r["cgolf_found"] else "non",
            "match_score": r["match_score"],
            "cgolf_name":  r.get("cgolf_name", ""),
            "cgolf_url":   r["cgolf_url"],
            "holes_count": sc["holes_count"],
            "has_par":     "oui" if sc["has_par"]  else ("?" if r["cgolf_found"] else "non"),
            "has_hcp":     "oui" if sc["has_hcp"]  else ("?" if r["cgolf_found"] else "non"),
            "has_dist":    "oui" if sc["has_dist"] else ("?" if r["cgolf_found"] else "non"),
        })

    print("═" * W)
    print(f"Total OSM : {len(osm_courses)} | Matchés cgolf : {osm_matched} ({total_rows} lignes)")

    # ── 6. Export CSV ─────────────────────────────────────────────────────────
    if csv_rows:
        csv_path = OUTPUT_DIR / "osm_cgolf_report.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(csv_rows[0].keys()))
            writer.writeheader()
            writer.writerows(csv_rows)
        print(f"\n✓ Rapport CSV      : {csv_path}")

    if not args.dry_run:
        print(f"✓ Scorecards JPEG  : {OUTPUT_DIR}/scorecard_*.jpg")
        print(f"✓ Fiches JSON      : {OUTPUT_DIR}/cgolf_*.json")


if __name__ == "__main__":
    main()
