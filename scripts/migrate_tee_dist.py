#!/usr/bin/env python3
"""
Migre les distances de départ de golf=tee vers golf=hole
au format dist:<couleur>=<mètres> pour Golf du Gouverneur (Le Breuil, Montaplan).

Phases :
  Phase 1 — Affiche le plan de migration dist:<couleur> sur golf=hole.
             Demande validation avant écriture.
  Phase 2 — (--remove-tee-dist) Affiche le plan de suppression des dist/distance
             sur golf=tee. Demande validation séparée avant suppression.

Non destructif par défaut : les tags dist/distance sur les tees ne sont pas supprimés.
Utiliser --remove-tee-dist pour la phase de nettoyage ultérieure.

Usage :
  # Prévisualisation sans écriture
  python migrate_tee_dist.py --dry-run

  # Migration des distances sur les trous (validation interactive)
  python migrate_tee_dist.py --client-id ID --client-secret SECRET

  # Migration + nettoyage des tees (deux validations séparées)
  python migrate_tee_dist.py --client-id ID --client-secret SECRET --remove-tee-dist

Dépendances : requests (pip install requests)
"""

import argparse
import re
import sys
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OSM_API       = "https://api.openstreetmap.org/api/0.6"
OSM_AUTH_URL  = "https://www.openstreetmap.org/oauth2/authorize"
OSM_TOKEN_URL = "https://www.openstreetmap.org/oauth2/token"
OSM_REDIRECT  = "urn:ietf:wg:oauth:2.0:oob"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
OVERPASS_MAX_RETRIES   = 3
OVERPASS_RETRY_DELAY_S = 5

OVERPASS_CENTER_QUERY = "[out:json][timeout:15]; relation(8362488); out center;"

# Requête : hole ways + tee nodes/ways (tags uniquement, pas de géométrie)
OVERPASS_QUERY_TEMPLATE = """
[out:json][timeout:30];
(
  way["golf"="hole"](around:5000,{lat},{lng});
  node["golf"="tee"](around:5000,{lat},{lng});
  way["golf"="tee"](around:5000,{lat},{lng});
);
out tags;
"""

VALID_COURSES = {"Le Breuil", "Montaplan"}

CHANGESET_COMMENT_HOLE = "Add dist:<color> tags on golf=hole ways - Golf du Gouverneur"
CHANGESET_COMMENT_TEE  = "Remove legacy dist/distance tags from golf=tee - Golf du Gouverneur"

PUT_DELAY_S = 0.5


# ---------------------------------------------------------------------------
# Helpers clé course|ref
# ---------------------------------------------------------------------------

def _course_ref_key(tags: dict) -> str | None:
    """
    Retourne la clé 'course|ref' depuis les tags OSM, ou None si invalide.
    Le tag course doit être présent et appartenir à VALID_COURSES.
    """
    try:
        ref = int(tags.get("ref", ""))
        if ref <= 0:
            return None
    except (ValueError, TypeError):
        return None
    course = tags.get("course", "").strip()
    if course not in VALID_COURSES:
        return None
    return f"{course}|{ref}"


def _course_ref_key_from_hole_name(hole_name: str | None) -> str | None:
    """Dérive une clé 'course|ref' depuis un tag hole_name legacy."""
    if not hole_name:
        return None
    parts = hole_name.split(" - ")
    if len(parts) < 2:
        return None
    course = parts[0].strip()
    if course not in VALID_COURSES:
        return None
    match = re.search(r"\d+", parts[-1])
    if not match:
        return None
    ref = int(match.group())
    return f"{course}|{ref}" if ref > 0 else None


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
    """Récupère les éléments golf=hole et golf=tee via Overpass en deux étapes."""
    print("Étape 1 — Centre de la relation 8362488...")
    center_data = _overpass_post(OVERPASS_CENTER_QUERY)
    relations = center_data.get("elements", [])
    if not relations or "center" not in relations[0]:
        raise RuntimeError("Impossible de récupérer le centre de la relation 8362488.")
    lat = relations[0]["center"]["lat"]
    lng = relations[0]["center"]["lon"]
    print(f"  → Centre : lat={lat}, lng={lng}")

    print("Étape 2 — Éléments golf (hole + tee)...")
    data = _overpass_post(OVERPASS_QUERY_TEMPLATE.format(lat=lat, lng=lng))
    elements = data.get("elements", [])
    print(f"  → {len(elements)} éléments reçus\n")
    return elements


# ---------------------------------------------------------------------------
# Phase 1 : planification migration dist → golf=hole
# ---------------------------------------------------------------------------

def _to_meters(raw: str) -> int | None:
    """
    Convertit une valeur dist en mètres entiers.
    Heuristique : si valeur < 10.0 → supposé en km → ×1000 ; sinon → déjà en mètres.
    """
    try:
        val = float(raw)
        if val <= 0:
            return None
        return round(val * 1000) if val < 10.0 else round(val)
    except (ValueError, TypeError):
        return None


def build_hole_dist_plan(elements: list[dict]) -> dict:
    """
    Construit le plan de migration.

    Retourne un dict :
    {
      "Le Breuil|1": {
          "hole_id":   <int>,
          "hole_type": "way",
          "dists":     {"white": 310, "yellow": 280, ...},
      },
      ...
    }
    """
    # Index des holes par clé course|ref
    holes: dict[str, dict] = {}
    for e in elements:
        tags = e.get("tags", {})
        if tags.get("golf") != "hole" or e["type"] != "way":
            continue
        key = _course_ref_key(tags) or _course_ref_key_from_hole_name(tags.get("hole_name"))
        if key is None:
            continue
        holes[key] = {
            "hole_id":   e["id"],
            "hole_type": e["type"],
            "dists":     {},
        }

    # Association des distances de tee → trou
    tee_no_key    = 0
    tee_no_dist   = 0
    tee_no_color  = 0

    for e in elements:
        tags = e.get("tags", {})
        if tags.get("golf") != "tee":
            continue

        key = _course_ref_key(tags) or _course_ref_key_from_hole_name(tags.get("hole_name"))
        if key is None or key not in holes:
            tee_no_key += 1
            continue

        color_raw = tags.get("tee", "").strip()
        if not color_raw:
            tee_no_color += 1
            continue

        raw_dist = (tags.get("dist") or tags.get("distance") or "").strip()
        dist_m = _to_meters(raw_dist)
        if dist_m is None:
            tee_no_dist += 1
            continue

        # Un tee peut avoir plusieurs couleurs séparées par ';' (ex: "white;black")
        for color in (c.strip() for c in color_raw.split(";") if c.strip()):
            holes[key]["dists"][color] = dist_m

    if tee_no_key or tee_no_dist or tee_no_color:
        print(f"Tees ignorés : {tee_no_key} (clé introuvable), "
              f"{tee_no_color} (pas de couleur), {tee_no_dist} (pas de dist)")

    return holes


def print_hole_dist_plan(plan: dict) -> None:
    """Affiche le plan de migration sous forme de tableau lisible."""
    all_colors: set[str] = set()
    for entry in plan.values():
        all_colors.update(entry["dists"].keys())

    if not all_colors:
        print("  Aucune donnée dist trouvée sur les tees.\n")
        return

    colors  = sorted(all_colors)
    col_w   = max(len(c) for c in colors) + 2
    key_w   = max((len(k) for k in plan), default=15) + 2

    header = f"{'Trou':<{key_w}}" + "".join(f"{c:>{col_w}}" for c in colors)
    print(header)
    print("─" * len(header))

    for key in sorted(plan.keys()):
        dists = plan[key]["dists"]
        row = f"{key:<{key_w}}"
        for c in colors:
            cell = f"{dists[c]}m" if c in dists else "-"
            row += f"{cell:>{col_w}}"
        print(row)

    holes_with = sum(1 for e in plan.values() if e["dists"])
    holes_without = len(plan) - holes_with
    print(f"\n  Trous avec dist : {holes_with}  |  Trous sans dist : {holes_without}\n")


# ---------------------------------------------------------------------------
# Phase 2 : planification nettoyage dist sur golf=tee
# ---------------------------------------------------------------------------

def build_tee_cleanup_plan(elements: list[dict]) -> list[dict]:
    """
    Retourne la liste des tees ayant un tag dist ou distance à supprimer.
    """
    to_clean = []
    for e in elements:
        tags = e.get("tags", {})
        if tags.get("golf") != "tee":
            continue
        key = _course_ref_key(tags) or _course_ref_key_from_hole_name(tags.get("hole_name"))
        if key is None:
            continue
        # Détermine lequel des deux tags est présent (dist prioritaire)
        dist_tag = "dist" if "dist" in tags else ("distance" if "distance" in tags else None)
        if dist_tag is None:
            continue
        to_clean.append({
            "type":      e["type"],
            "id":        e["id"],
            "key":       key,
            "color":     tags.get("tee", "?"),
            "dist_tag":  dist_tag,
            "dist_val":  tags.get(dist_tag, "?"),
        })
    return to_clean


def print_tee_cleanup_plan(plan: list[dict]) -> None:
    """Affiche les tees dont le tag dist/distance sera supprimé."""
    print(f"Tees avec dist/distance à supprimer : {len(plan)}\n")
    for item in sorted(plan, key=lambda x: (x["key"], x["color"])):
        print(f"  {item['type']}/{item['id']:<12}  {item['key']:<18}  "
              f"tee={item['color']:<12}  {item['dist_tag']}={item['dist_val']}")
    print()


# ---------------------------------------------------------------------------
# OSM API
# ---------------------------------------------------------------------------

def oauth2_get_token(client_id: str, client_secret: str) -> str:
    """Flux OAuth 2.0 authorization code (OOB) → retourne l'access_token."""
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


def create_changeset(session: requests.Session, comment: str) -> str:
    """Crée un changeset OSM et retourne son ID."""
    root = ET.Element("osm", version="0.6")
    cs = ET.SubElement(root, "changeset")
    ET.SubElement(cs, "tag", k="comment",    v=comment)
    ET.SubElement(cs, "tag", k="created_by", v="GolfTracker/migrate_tee_dist.py")
    xml = '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")
    resp = session.put(
        f"{OSM_API}/changeset/create",
        data=xml.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
    )
    resp.raise_for_status()
    changeset_id = resp.text.strip()
    print(f"Changeset créé : {changeset_id}")
    print(f"  https://www.openstreetmap.org/changeset/{changeset_id}\n")
    return changeset_id


def close_changeset(session: requests.Session, changeset_id: str) -> None:
    session.put(f"{OSM_API}/changeset/{changeset_id}/close")
    print(f"Changeset {changeset_id} fermé.")


def _get_element_xml(session: requests.Session, elem_type: str, elem_id: int) -> ET.Element:
    resp = session.get(f"{OSM_API}/{elem_type}/{elem_id}")
    resp.raise_for_status()
    return ET.fromstring(resp.text)


def _put_element_xml(
    session: requests.Session,
    elem_type: str,
    elem_id: int,
    root: ET.Element,
) -> None:
    xml_str = ET.tostring(root, encoding="unicode")
    session.put(
        f"{OSM_API}/{elem_type}/{elem_id}",
        data=xml_str.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
    ).raise_for_status()


# ---------------------------------------------------------------------------
# Application : dist:<color> sur golf=hole
# ---------------------------------------------------------------------------

def apply_hole_dists(
    session: requests.Session,
    plan: dict,
    changeset_id: str,
    verbose: bool,
) -> tuple[int, int, list[tuple]]:
    """
    Ajoute/met à jour les tags dist:<color>=<meters> sur les way[golf=hole].
    Retourne (mis_à_jour, déjà_corrects, erreurs).
    """
    to_update = sorted(
        [(k, v) for k, v in plan.items() if v["dists"]],
        key=lambda x: x[0],
    )
    total = len(to_update)
    updated = already_ok = 0
    errors: list[tuple] = []

    for i, (key, entry) in enumerate(to_update, 1):
        elem_type = entry["hole_type"]
        elem_id   = entry["hole_id"]
        dists     = entry["dists"]
        prefix    = f"  [{i:3d}/{total}] {elem_type}/{elem_id}  ({key})"

        try:
            root = _get_element_xml(session, elem_type, elem_id)
            elem = root.find(elem_type)
            if elem is None:
                raise ValueError(f"Élément <{elem_type}> introuvable dans le XML retourné")

            changed = False
            for color, dist_m in sorted(dists.items()):
                tag_key = f"dist:{color}"
                existing = elem.find(f"tag[@k='{tag_key}']")
                if existing is not None:
                    if existing.get("v") == str(dist_m):
                        continue  # déjà correct
                    existing.set("v", str(dist_m))
                    changed = True
                else:
                    new_tag = ET.SubElement(elem, "tag")
                    new_tag.set("k", tag_key)
                    new_tag.set("v", str(dist_m))
                    changed = True

            if not changed:
                if verbose:
                    print(f"{prefix}  (déjà correct)")
                already_ok += 1
                continue

            elem.set("changeset", changeset_id)
            _put_element_xml(session, elem_type, elem_id, root)
            tags_summary = ", ".join(f"dist:{c}={m}m" for c, m in sorted(dists.items()))
            print(f"{prefix}  ✓  {tags_summary}")
            updated += 1
            time.sleep(PUT_DELAY_S)

        except Exception as exc:
            print(f"{prefix}  ERREUR : {exc}")
            errors.append((elem_type, elem_id, str(exc)))

    return updated, already_ok, errors


# ---------------------------------------------------------------------------
# Application : suppression dist sur golf=tee
# ---------------------------------------------------------------------------

def apply_tee_cleanup(
    session: requests.Session,
    plan: list[dict],
    changeset_id: str,
    verbose: bool,
) -> tuple[int, int, list[tuple]]:
    """
    Supprime les tags dist/distance des tee nodes/ways.
    Retourne (supprimés, déjà_absents, erreurs).
    """
    total = len(plan)
    updated = already_ok = 0
    errors: list[tuple] = []

    for i, item in enumerate(sorted(plan, key=lambda x: (x["key"], x["color"])), 1):
        elem_type = item["type"]
        elem_id   = item["id"]
        dist_tag  = item["dist_tag"]
        prefix    = f"  [{i:3d}/{total}] {elem_type}/{elem_id}  ({item['key']}, tee={item['color']})"

        try:
            root = _get_element_xml(session, elem_type, elem_id)
            elem = root.find(elem_type)
            if elem is None:
                raise ValueError(f"Élément <{elem_type}> introuvable dans le XML retourné")

            tag_elem = elem.find(f"tag[@k='{dist_tag}']")
            if tag_elem is None:
                if verbose:
                    print(f"{prefix}  (tag absent, rien à faire)")
                already_ok += 1
                continue

            elem.remove(tag_elem)
            elem.set("changeset", changeset_id)
            _put_element_xml(session, elem_type, elem_id, root)
            print(f"{prefix}  ✓  {dist_tag} supprimé")
            updated += 1
            time.sleep(PUT_DELAY_S)

        except Exception as exc:
            print(f"{prefix}  ERREUR : {exc}")
            errors.append((elem_type, elem_id, str(exc)))

    return updated, already_ok, errors


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migre les dist de golf=tee vers dist:<color> sur golf=hole (Golf du Gouverneur)"
    )
    parser.add_argument("--dry-run",         action="store_true",
                        help="Prévisualise les changements sans écrire sur OSM")
    parser.add_argument("--client-id",       help="Client ID de l'application OAuth 2 OSM")
    parser.add_argument("--client-secret",   help="Client Secret de l'application OAuth 2 OSM")
    parser.add_argument("--verbose",         action="store_true",
                        help="Affiche aussi les éléments déjà corrects / déjà absents")
    parser.add_argument("--remove-tee-dist", action="store_true",
                        help="Active la phase 2 : suppression des dist/distance sur golf=tee")
    args = parser.parse_args()

    if not args.dry_run and (not args.client_id or not args.client_secret):
        print("ERREUR : --client-id et --client-secret sont requis hors dry-run.")
        print("Crée une application sur : https://www.openstreetmap.org/oauth2/applications")
        sys.exit(1)

    # ── Collecte Overpass ──────────────────────────────────────────────────
    elements = fetch_elements()

    # ── Phase 1 : plan migration dist:<color> sur golf=hole ────────────────
    print("═" * 60)
    print("PHASE 1 — Migration dist:<couleur> sur golf=hole")
    print("═" * 60)
    hole_plan = build_hole_dist_plan(elements)
    print_hole_dist_plan(hole_plan)

    holes_to_update = [(k, v) for k, v in hole_plan.items() if v["dists"]]

    # ── Phase 2 : plan nettoyage tees (si demandé) ─────────────────────────
    tee_plan: list[dict] = []
    if args.remove_tee_dist:
        print("═" * 60)
        print("PHASE 2 — Suppression dist/distance sur golf=tee")
        print("═" * 60)
        tee_plan = build_tee_cleanup_plan(elements)
        print_tee_cleanup_plan(tee_plan)

    if args.dry_run:
        print("[DRY RUN] Aucune modification envoyée à OSM.")
        return

    # ── Authentification OAuth (une seule fois pour les deux phases) ────────
    session: requests.Session | None = None

    # ── Application phase 1 ────────────────────────────────────────────────
    if not holes_to_update:
        print("Phase 1 : rien à faire (aucun trou avec données dist).\n")
    else:
        confirm1 = input(
            f"Appliquer dist:<couleur> sur {len(holes_to_update)} golf=hole ? [oui/N] "
        ).strip().lower()

        if confirm1 != "oui":
            print("Phase 1 annulée.\n")
        else:
            token = oauth2_get_token(args.client_id, args.client_secret)
            session = requests.Session()
            session.headers.update({"Authorization": f"Bearer {token}"})

            changeset_id = create_changeset(session, CHANGESET_COMMENT_HOLE)
            try:
                updated, already_ok, errors = apply_hole_dists(
                    session, hole_plan, changeset_id, args.verbose
                )
            finally:
                close_changeset(session, changeset_id)

            print(f"\nRésumé phase 1 :")
            print(f"  Mis à jour     : {updated}")
            print(f"  Déjà corrects  : {already_ok}")
            print(f"  Erreurs        : {len(errors)}")
            if errors:
                print("\n  Détail des erreurs :")
                for et, ei, msg in errors:
                    print(f"    {et}/{ei} : {msg}")
            print()

    # ── Application phase 2 (nettoyage tees) ──────────────────────────────
    if not args.remove_tee_dist:
        return

    if not tee_plan:
        print("Phase 2 : rien à faire (aucun tee avec dist/distance).\n")
        return

    confirm2 = input(
        f"Supprimer dist/distance de {len(tee_plan)} golf=tee ? [oui/N] "
    ).strip().lower()

    if confirm2 != "oui":
        print("Phase 2 annulée.")
        return

    # Réutilise la session existante ou en crée une nouvelle si phase 1 annulée
    if session is None:
        token2 = oauth2_get_token(args.client_id, args.client_secret)
        session = requests.Session()
        session.headers.update({"Authorization": f"Bearer {token2}"})

    changeset_id2 = create_changeset(session, CHANGESET_COMMENT_TEE)
    try:
        updated2, already_ok2, errors2 = apply_tee_cleanup(
            session, tee_plan, changeset_id2, args.verbose
        )
    finally:
        close_changeset(session, changeset_id2)

    print(f"\nRésumé phase 2 :")
    print(f"  Supprimés      : {updated2}")
    print(f"  Déjà absents   : {already_ok2}")
    print(f"  Erreurs        : {len(errors2)}")
    if errors2:
        print("\n  Détail des erreurs :")
        for et, ei, msg in errors2:
            print(f"    {et}/{ei} : {msg}")


if __name__ == "__main__":
    main()
