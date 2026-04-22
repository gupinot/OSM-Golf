#!/usr/bin/env python3
"""
Adds course=<name> tag to golf=hole, golf=green, golf=tee elements
for Le Breuil and Montaplan at Golf du Gouverneur (OSM relation/8362488).

Éléments exclus :
  - La Soche (football golf, sport=footballgolf)
  - Trous d'entraînement (name/hole_name contient "entraînement")
  - Tout élément dont le cours ne correspond pas à VALID_COURSES

Usage :
  # Prévisualisation sans écriture
  python add_course_tag.py --dry-run

  # Application réelle (flux OAuth 2.0 interactif)
  python add_course_tag.py --client-id TON_ID --client-secret TON_SECRET

  # Application réelle avec résumé verbose
  python add_course_tag.py --client-id TON_ID --client-secret TON_SECRET --verbose

Dépendances : requests (pip install requests)
"""

import argparse
import sys
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET
from collections import Counter

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OSM_API       = "https://api.openstreetmap.org/api/0.6"
OSM_AUTH_URL  = "https://www.openstreetmap.org/oauth2/authorize"
OSM_TOKEN_URL = "https://www.openstreetmap.org/oauth2/token"
OSM_REDIRECT  = "urn:ietf:wg:oauth:2.0:oob"

# Endpoints Overpass tentés dans l'ordre en cas d'échec
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

OVERPASS_MAX_RETRIES = 3
OVERPASS_RETRY_DELAY_S = 5

# Requête 1 : récupère le centre de la relation pour en déduire les coordonnées réelles
OVERPASS_CENTER_QUERY = "[out:json][timeout:15]; relation(8362488); out center;"

# Requête 2 : récupère les éléments golf autour de ce centre (rayon 5 km)
# {lat} et {lng} sont remplacés dynamiquement par fetch_elements()
OVERPASS_QUERY_TEMPLATE = """
[out:json][timeout:30];
(
  way["golf"="hole"](around:5000,{lat},{lng});
  node["golf"="tee"](around:5000,{lat},{lng});
  way["golf"="tee"](around:5000,{lat},{lng});
  way["golf"="green"](around:5000,{lat},{lng});
);
out tags;
"""

# Seuls ces noms de parcours seront traités
VALID_COURSES = {"Le Breuil", "Montaplan"}

CHANGESET_COMMENT = "Add course tag to golf holes/tees/greens - Le Breuil and Montaplan (Golf du Gouverneur)"

# Délai entre chaque appel PUT pour ne pas surcharger l'API OSM
PUT_DELAY_S = 0.5


# ---------------------------------------------------------------------------
# Logique métier
# ---------------------------------------------------------------------------

def extract_course(tags: dict) -> str | None:
    """
    Retourne le nom du parcours depuis les tags name ou hole_name.

    Formats attendus :
      "Le Breuil - Trou n°1"   → "Le Breuil"
      "Montaplan - Trou n°12"  → "Montaplan"

    Retourne None si le parcours n'est pas dans VALID_COURSES
    ou si le format ne correspond pas.
    """
    raw = tags.get("name") or tags.get("hole_name", "")
    if " - " not in raw:
        return None
    course = raw.split(" - ")[0].strip()
    return course if course in VALID_COURSES else None


# ---------------------------------------------------------------------------
# Overpass
# ---------------------------------------------------------------------------

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


def fetch_elements() -> list[dict]:
    """Récupère les éléments golf via Overpass en deux étapes."""
    # Étape 1 : centre de la relation pour avoir des coordonnées fiables
    print("Étape 1 — Centre de la relation 8362488...")
    center_data = _overpass_post(OVERPASS_CENTER_QUERY)
    relations = center_data.get("elements", [])
    if not relations or "center" not in relations[0]:
        raise RuntimeError("Impossible de récupérer le centre de la relation 8362488.")
    lat = relations[0]["center"]["lat"]
    lng = relations[0]["center"]["lon"]
    print(f"  → Centre : lat={lat}, lng={lng}")

    # Étape 2 : éléments golf autour de ce centre
    print("Étape 2 — Éléments golf autour du centre...")
    query = OVERPASS_QUERY_TEMPLATE.format(lat=lat, lng=lng)
    data = _overpass_post(query)
    elements = data.get("elements", [])
    print(f"  → {len(elements)} éléments reçus")
    return elements


def plan_updates(elements: list[dict]) -> tuple[list[dict], int]:
    """
    Filtre les éléments à mettre à jour et retourne
    (liste des mises à jour prévues, nombre ignorés).
    """
    to_update = []
    skipped = 0

    for e in elements:
        tags = e.get("tags", {})
        course = extract_course(tags)
        if course is None:
            skipped += 1
            continue
        to_update.append({
            "type":         e["type"],   # "way" ou "node"
            "id":           e["id"],
            "course":       course,
            "golf_type":    tags.get("golf", "?"),
            "source_tag":   "name" if "name" in tags else "hole_name",
        })

    return to_update, skipped


def print_plan(to_update: list[dict], skipped: int) -> None:
    print(f"\nÉléments à mettre à jour : {len(to_update)}")
    print(f"Ignorés (exclus / format non reconnu) : {skipped}\n")

    breakdown = Counter(
        f"{item['type']}[golf={item['golf_type']}] → course={item['course']}"
        for item in to_update
    )
    for label, count in sorted(breakdown.items()):
        print(f"  {count:3d}x  {label}")


# ---------------------------------------------------------------------------
# OSM API
# ---------------------------------------------------------------------------

def create_changeset(session: requests.Session) -> str:
    # Construire le XML via ElementTree pour garantir l'échappement correct
    root = ET.Element("osm", version="0.6")
    changeset = ET.SubElement(root, "changeset")
    ET.SubElement(changeset, "tag", k="comment", v=CHANGESET_COMMENT)
    ET.SubElement(changeset, "tag", k="created_by", v="GolfTracker/add_course_tag.py")
    xml = '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")
    resp = session.put(
        f"{OSM_API}/changeset/create",
        data=xml.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
    )
    resp.raise_for_status()
    changeset_id = resp.text.strip()
    print(f"\nChangeset créé : {changeset_id}")
    print(f"  https://www.openstreetmap.org/changeset/{changeset_id}")
    return changeset_id


def close_changeset(session: requests.Session, changeset_id: str) -> None:
    session.put(f"{OSM_API}/changeset/{changeset_id}/close")
    print(f"\nChangeset {changeset_id} fermé.")


def get_osm_element_xml(session: requests.Session, elem_type: str, elem_id: int) -> ET.Element:
    resp = session.get(f"{OSM_API}/{elem_type}/{elem_id}")
    resp.raise_for_status()
    return ET.fromstring(resp.text)


def build_updated_xml(
    root: ET.Element,
    elem_type: str,
    changeset_id: str,
    course: str,
) -> str | None:
    """
    Injecte le tag course dans le XML de l'élément OSM.
    Retourne None si le tag est déjà correct (pas de PUT nécessaire).
    Retourne le XML modifié (string) sinon.
    """
    elem = root.find(elem_type)
    if elem is None:
        return None

    for tag in elem.findall("tag"):
        if tag.get("k") == "course":
            if tag.get("v") == course:
                return None  # déjà correct
            tag.set("v", course)  # valeur incorrecte → corrige
            elem.set("changeset", changeset_id)
            return ET.tostring(root, encoding="unicode")

    # Tag absent → ajoute
    new_tag = ET.SubElement(elem, "tag")
    new_tag.set("k", "course")
    new_tag.set("v", course)
    elem.set("changeset", changeset_id)
    return ET.tostring(root, encoding="unicode")


def apply_updates(
    session: requests.Session,
    to_update: list[dict],
    changeset_id: str,
    verbose: bool,
) -> tuple[int, int, list[tuple]]:
    """
    Applique les mises à jour sur l'API OSM.
    Retourne (updated, already_ok, errors).
    """
    updated    = 0
    already_ok = 0
    errors     = []

    total = len(to_update)
    for i, item in enumerate(to_update, 1):
        elem_type = item["type"]
        elem_id   = item["id"]
        course    = item["course"]

        prefix = f"  [{i:3d}/{total}] {elem_type}/{elem_id}  course={course}"

        try:
            root    = get_osm_element_xml(session, elem_type, elem_id)
            xml_str = build_updated_xml(root, elem_type, changeset_id, course)

            if xml_str is None:
                if verbose:
                    print(f"{prefix}  (déjà correct)")
                already_ok += 1
            else:
                session.put(
                    f"{OSM_API}/{elem_type}/{elem_id}",
                    data=xml_str.encode("utf-8"),
                    headers={"Content-Type": "text/xml"},
                ).raise_for_status()
                print(f"{prefix}  ✓")
                updated += 1
                time.sleep(PUT_DELAY_S)

        except Exception as exc:
            print(f"{prefix}  ERREUR : {exc}")
            errors.append((elem_type, elem_id, str(exc)))

    return updated, already_ok, errors


# ---------------------------------------------------------------------------
# Authentification OAuth 2.0 (authorization code flow, OOB)
# ---------------------------------------------------------------------------

def oauth2_get_token(client_id: str, client_secret: str) -> str:
    """
    Flux OAuth 2.0 interactif :
    1. Ouvre le navigateur sur la page d'autorisation OSM
    2. L'utilisateur autorise l'app et reçoit un code
    3. Le script échange ce code contre un access_token
    """
    params = {
        "client_id":     client_id,
        "redirect_uri":  OSM_REDIRECT,
        "response_type": "code",
        "scope":         "write_api",
    }
    auth_url = OSM_AUTH_URL + "?" + urllib.parse.urlencode(params)

    print("\nOuverture du navigateur pour autoriser l'accès OSM...")
    print(f"Si le navigateur ne s'ouvre pas, copie cette URL :\n  {auth_url}\n")
    webbrowser.open(auth_url)

    code = input("Colle ici le code d'autorisation affiché par OSM : ").strip()
    if not code:
        print("ERREUR : code vide.")
        sys.exit(1)

    resp = requests.post(
        OSM_TOKEN_URL,
        data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  OSM_REDIRECT,
            "client_id":     client_id,
            "client_secret": client_secret,
        },
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        print(f"ERREUR : réponse inattendue du serveur OAuth : {resp.text}")
        sys.exit(1)
    print("  → Token obtenu.\n")
    return token


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ajoute course= sur les éléments golf du Golf du Gouverneur"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Prévisualise les changements sans écrire sur OSM",
    )
    parser.add_argument("--client-id",     help="Client ID de l'application OAuth 2 OSM")
    parser.add_argument("--client-secret", help="Client Secret de l'application OAuth 2 OSM")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Affiche aussi les éléments déjà corrects",
    )
    args = parser.parse_args()

    if not args.dry_run and (not args.client_id or not args.client_secret):
        print("ERREUR : --client-id et --client-secret sont requis hors dry-run.")
        print("Crée une application sur : https://www.openstreetmap.org/oauth2/applications")
        sys.exit(1)

    # 1. Récupération via Overpass
    elements = fetch_elements()

    # 2. Planification
    to_update, skipped = plan_updates(elements)
    print_plan(to_update, skipped)

    if not to_update:
        print("\nRien à faire.")
        return

    if args.dry_run:
        print("\n[DRY RUN] Aucune modification envoyée à OSM.")
        return

    # 3. Confirmation interactive
    print()
    confirm = input(f"Appliquer {len(to_update)} modifications sur OSM ? [oui/N] ").strip().lower()
    if confirm != "oui":
        print("Annulé.")
        return

    # 4. Authentification OAuth 2.0 → access token
    token = oauth2_get_token(args.client_id, args.client_secret)
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}"})

    # 5. Changeset + mises à jour
    changeset_id = create_changeset(session)
    print()

    try:
        updated, already_ok, errors = apply_updates(
            session, to_update, changeset_id, args.verbose
        )
    finally:
        close_changeset(session, changeset_id)

    # 6. Résumé
    print(f"\nRésumé :")
    print(f"  Mis à jour  : {updated}")
    print(f"  Déjà corrects : {already_ok}")
    print(f"  Erreurs     : {len(errors)}")
    if errors:
        print("\nDétail des erreurs :")
        for elem_type, elem_id, msg in errors:
            print(f"  {elem_type}/{elem_id} : {msg}")


if __name__ == "__main__":
    main()
