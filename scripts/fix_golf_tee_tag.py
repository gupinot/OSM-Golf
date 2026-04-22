#!/usr/bin/env python3
"""
Corrige le tag golf:tee → tee sur les zones de tee du Golf de la Bresse.

Problème : le script de peuplement a posé golf:tee=<couleur> au lieu
           du tag standard tee=<couleur>.
Ce script :
  1. Interroge Overpass pour trouver tous les éléments golf=tee
     ayant le tag golf:tee dans la bbox du parcours.
  2. Affiche le plan de correction.
  3. Demande confirmation avant tout envoi.
  4. Pour chacun : supprime golf:tee, pose tee avec la même valeur.

Usage :
  # Prévisualisation sans écriture
  python fix_golf_tee_tag.py --dry-run

  # Application réelle (flux OAuth 2.0 interactif)
  python fix_golf_tee_tag.py --client-id TON_ID --client-secret TON_SECRET

  # Avec affichage des éléments déjà corrects
  python fix_golf_tee_tag.py --client-id TON_ID --client-secret TON_SECRET --verbose

Dépendances : requests (pip install requests)
"""

import argparse
import sys
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET

import requests

# ── Configuration ──────────────────────────────────────────────────────────────

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

BBOX = "46.126,5.092,46.156,5.122"

OVERPASS_QUERY = f"""[out:json][timeout:30][bbox:{BBOX}];
(
  way["golf"="tee"]["golf:tee"];
  node["golf"="tee"]["golf:tee"];
);
out tags;"""

CHANGESET_COMMENT = "Golf de la Bresse — fix tag golf:tee → tee (standard OSM golf schema)"
PUT_DELAY_S = 0.5


# ── Overpass ───────────────────────────────────────────────────────────────────

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
    print("Récupération Overpass (golf=tee avec golf:tee)...")
    data     = _overpass_post(OVERPASS_QUERY)
    elements = data.get("elements", [])
    print(f"  → {len(elements)} élément(s) trouvé(s)\n")
    return elements


# ── Plan ───────────────────────────────────────────────────────────────────────

def build_plan(elements: list[dict]) -> list[dict]:
    """Retourne la liste des éléments à corriger."""
    plan = []
    for e in elements:
        tags = e.get("tags", {})
        val  = tags.get("golf:tee", "").strip()
        if not val:
            continue
        plan.append({
            "type":    e["type"],
            "id":      e["id"],
            "ref":     tags.get("ref", "?"),
            "new_val": val,
        })
    return plan


def print_plan(plan: list[dict]) -> None:
    if not plan:
        print("Rien à corriger.")
        return
    sep = "─" * 65
    print(sep)
    print("Éléments à corriger (golf:tee → tee)")
    print(sep)
    print(f"  {'Type':>5}  {'ID':>12}  {'ref':>5}  Correction")
    print(sep)
    for item in sorted(plan, key=lambda x: (x["ref"], x["type"], x["id"])):
        print(f"  {item['type']:>5}  {item['id']:>12}  {item['ref']:>5}  "
              f"golf:tee={item['new_val']} → tee={item['new_val']}")
    print(sep)
    print(f"  → {len(plan)} modification(s) prévue(s)\n")


# ── OSM API ────────────────────────────────────────────────────────────────────

def oauth2_get_token(client_id: str, client_secret: str) -> str:
    """Flux OAuth 2.0 interactif (authorization code, OOB)."""
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

    resp = requests.post(OSM_TOKEN_URL, data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  OSM_REDIRECT,
        "client_id":     client_id,
        "client_secret": client_secret,
    })
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        print(f"ERREUR : réponse inattendue du serveur OAuth : {resp.text}")
        sys.exit(1)
    print("  → Token obtenu.\n")
    return token


def create_changeset(session: requests.Session) -> str:
    root = ET.Element("osm", version="0.6")
    cs   = ET.SubElement(root, "changeset")
    ET.SubElement(cs, "tag", k="comment",    v=CHANGESET_COMMENT)
    ET.SubElement(cs, "tag", k="created_by", v="GolfTracker/fix_golf_tee_tag.py")
    xml = '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")
    resp = session.put(f"{OSM_API}/changeset/create",
                       data=xml.encode("utf-8"),
                       headers={"Content-Type": "text/xml"})
    resp.raise_for_status()
    cid = resp.text.strip()
    print(f"Changeset créé : {cid}")
    print(f"  https://www.openstreetmap.org/changeset/{cid}\n")
    return cid


def close_changeset(session: requests.Session, cid: str) -> None:
    session.put(f"{OSM_API}/changeset/{cid}/close")
    print(f"\nChangeset {cid} fermé.")


def build_updated_xml(
    root: ET.Element,
    elem_type: str,
    changeset_id: str,
    new_val: str,
) -> str | None:
    """
    Supprime golf:tee et pose tee=new_val sur l'élément XML.
    Retourne None si golf:tee est absent (déjà corrigé).
    Retourne le XML modifié sinon.
    """
    elem = root.find(elem_type)
    if elem is None:
        return None

    golf_tee_tag = elem.find("tag[@k='golf:tee']")
    if golf_tee_tag is None:
        return None  # déjà corrigé

    elem.remove(golf_tee_tag)

    tee_tag = elem.find("tag[@k='tee']")
    if tee_tag is not None:
        tee_tag.set("v", new_val)
    else:
        new_tag = ET.SubElement(elem, "tag")
        new_tag.set("k", "tee")
        new_tag.set("v", new_val)

    elem.set("changeset", changeset_id)
    return ET.tostring(root, encoding="unicode")


def apply_updates(
    session: requests.Session,
    plan: list[dict],
    changeset_id: str,
    verbose: bool,
) -> tuple[int, int, list[tuple]]:
    """
    Applique les corrections sur l'API OSM.
    Retourne (updated, already_ok, errors).
    """
    updated = already_ok = 0
    errors: list[tuple] = []
    total = len(plan)

    for i, item in enumerate(plan, 1):
        elem_type = item["type"]
        elem_id   = item["id"]
        new_val   = item["new_val"]
        prefix    = f"  [{i:3d}/{total}] {elem_type}/{elem_id}  (ref={item['ref']})"

        try:
            resp = session.get(f"{OSM_API}/{elem_type}/{elem_id}")
            resp.raise_for_status()
            root    = ET.fromstring(resp.text)
            xml_str = build_updated_xml(root, elem_type, changeset_id, new_val)

            if xml_str is None:
                if verbose:
                    print(f"{prefix}  (déjà correct)")
                already_ok += 1
                continue

            session.put(
                f"{OSM_API}/{elem_type}/{elem_id}",
                data=xml_str.encode("utf-8"),
                headers={"Content-Type": "text/xml"},
            ).raise_for_status()
            print(f"{prefix}  ✓  golf:tee={new_val} → tee={new_val}")
            updated += 1
            time.sleep(PUT_DELAY_S)

        except Exception as exc:
            print(f"{prefix}  ERREUR : {exc}")
            errors.append((elem_type, elem_id, str(exc)))

    return updated, already_ok, errors


# ── Point d'entrée ─────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Corrige le tag golf:tee → tee sur les tees du Golf de la Bresse",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run",       action="store_true",
                        help="Prévisualise sans écrire sur OSM")
    parser.add_argument("--client-id",     help="Client ID OAuth 2 OSM")
    parser.add_argument("--client-secret", help="Client Secret OAuth 2 OSM")
    parser.add_argument("--verbose",       action="store_true",
                        help="Affiche aussi les éléments déjà corrects")
    args = parser.parse_args()

    if not args.dry_run and (not args.client_id or not args.client_secret):
        print("ERREUR : --client-id et --client-secret sont requis hors dry-run.")
        print("Crée une application sur : https://www.openstreetmap.org/oauth2/applications")
        sys.exit(1)

    # 1. Collecte
    elements = fetch_elements()

    # 2. Plan
    plan = build_plan(elements)
    print_plan(plan)

    if not plan:
        return

    if args.dry_run:
        print("[DRY RUN] Aucune modification envoyée à OSM.")
        return

    # 3. Confirmation
    confirm = input(f"Appliquer {len(plan)} correction(s) sur OSM ? [oui/N] ").strip().lower()
    if confirm != "oui":
        print("Annulé.")
        return

    # 4. OAuth + session
    token   = oauth2_get_token(args.client_id, args.client_secret)
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}"})

    # 5. Changeset + mises à jour
    cid = create_changeset(session)
    try:
        updated, already_ok, errors = apply_updates(session, plan, cid, args.verbose)
    finally:
        close_changeset(session, cid)

    # 6. Résumé
    print(f"\nRésumé :")
    print(f"  Corrigés      : {updated}")
    print(f"  Déjà corrects : {already_ok}")
    print(f"  Erreurs       : {len(errors)}")
    if errors:
        print("\n  Détail des erreurs :")
        for et, ei, msg in errors:
            print(f"    {et}/{ei} : {msg}")


if __name__ == "__main__":
    main()
