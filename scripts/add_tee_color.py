#!/usr/bin/env python3
"""
Ajoute le tag golf:tee=<couleur> sur les zones de tee (node et way)
du Golf de la Bresse, par analyse géométrique hole way ↔ scorecard.

Usage :
  # Prévisualisation sans écriture
  python add_tee_color.py --dry-run

  # Application réelle (OAuth 2.0 interactif)
  python add_tee_color.py --client-id TON_ID --client-secret TON_SECRET

  # Inclure aussi les cas ambigus (tableau 3)
  python add_tee_color.py --client-id ID --client-secret SECRET --include-ambiguous

Dépendances : requests (pip install requests)
"""

import argparse
import math
import sys
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET
from collections import defaultdict

import requests

# ─── Configuration ────────────────────────────────────────────────────────────

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

OVERPASS_QUERY = f"""
[out:json][timeout:30][bbox:{BBOX}];
(
  way["golf"="hole"]["ref"];
  way["golf"="tee"]["ref"];
  node["golf"="tee"]["ref"];
);
out geom;
"""

CHANGESET_COMMENT = "Add golf:tee=<color> tags on tee nodes/ways - Golf de la Bresse (scorecard analysis)"
PUT_DELAY_S = 0.5

SCORECARD = {
    "1":  {"black": 311, "white": 311, "yellow": 266, "blue": 227, "red": 227},
    "2":  {"black": 285, "white": 285, "yellow": 244, "blue": 212, "red": 212},
    "3":  {"black": 459, "white": 459, "yellow": 439, "blue": 390, "red": 383},
    "4":  {"black": 366, "white": 366, "yellow": 331, "blue": 308, "red": 308},
    "5":  {"black": 158, "white": 158, "yellow": 135, "blue": 115, "red": 107},
    "6":  {"black": 405, "white": 405, "yellow": 360, "blue": 360, "red": 324},
    "7":  {"black": 360, "white": 360, "yellow": 317, "blue": 284, "red": 275},
    "8":  {"black": 194, "white": 194, "yellow": 184, "blue": 161, "red": 125},
    "9":  {"black": 502, "white": 502, "yellow": 454, "blue": 408, "red": 400},
    "10": {"black": 369, "white": 369, "yellow": 341, "blue": 318, "red": 295},
    "11": {"black": 271, "white": 271, "yellow": 264, "blue": 259, "red": 199},
    "12": {"black": 153, "white": 153, "yellow": 134, "blue": 107, "red": 102},
    "13": {"black": 448, "white": 448, "yellow": 412, "blue": 378, "red": 378},
    "14": {"black": 379, "white": 379, "yellow": 351, "blue": 313, "red": 292},
    "15": {"black": 307, "white": 307, "yellow": 292, "blue": 260, "red": 231},
    "16": {"black": 190, "white": 190, "yellow": 179, "blue": 172, "red": 139},
    "17": {"black": 372, "white": 372, "yellow": 339, "blue": 298, "red": 298},
    "18": {"black": 480, "white": 480, "yellow": 457, "blue": 415, "red": 363},
}

COLORS   = ["black", "white", "yellow", "blue", "red"]
HIGH_THR = 20   # m — confiance haute
MED_THR  = 40   # m — confiance moyenne
TEE_SIZE = 15   # m — différence max pour considérer 2 couleurs dans 1 même zone

# ─── Géométrie ────────────────────────────────────────────────────────────────

LAT_M = 111_000.0

def lon_m(lat):
    return LAT_M * math.cos(math.radians(lat))

def centroid(geom):
    pts = geom[:-1] if geom[0]["lat"] == geom[-1]["lat"] and geom[0]["lon"] == geom[-1]["lon"] else geom
    return sum(p["lat"] for p in pts) / len(pts), sum(p["lon"] for p in pts) / len(pts)

def project_onto_way(tee_lat, tee_lon, way_geom):
    """Retourne (distance_restante_jusqu_au_drapeau, dist_perpendiculaire) en mètres."""
    ref_lat = sum(p["lat"] for p in way_geom) / len(way_geom)
    origin  = way_geom[0]

    def to_m(p):
        return ((p["lon"] - origin["lon"]) * lon_m(ref_lat),
                (p["lat"] - origin["lat"]) * LAT_M)

    pts_m  = [to_m(p) for p in way_geom]
    tx, ty = to_m({"lat": tee_lat, "lon": tee_lon})

    seg_lens = [math.sqrt((pts_m[i+1][0]-pts_m[i][0])**2 + (pts_m[i+1][1]-pts_m[i][1])**2)
                for i in range(len(pts_m)-1)]
    total = sum(seg_lens)
    cum   = [0.0]
    for l in seg_lens:
        cum.append(cum[-1] + l)

    best_perp = best_cum = None
    for i in range(len(pts_m)-1):
        ax, ay = pts_m[i]; bx, by = pts_m[i+1]
        dx, dy = bx-ax, by-ay
        sl = seg_lens[i]
        if sl < 1e-6:
            continue
        t  = max(0.0, min(1.0, ((tx-ax)*dx + (ty-ay)*dy) / sl**2))
        px, py = ax+t*dx, ay+t*dy
        d = math.sqrt((tx-px)**2 + (ty-py)**2)
        if best_perp is None or d < best_perp:
            best_perp = d
            best_cum  = cum[i] + t*sl

    return total - best_cum, best_perp

# ─── Overpass ─────────────────────────────────────────────────────────────────

def _overpass_post(query):
    last_exc = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, OVERPASS_MAX_RETRIES+1):
            try:
                print(f"  Tentative {attempt}/{OVERPASS_MAX_RETRIES} → {endpoint}")
                resp = requests.post(endpoint, data={"data": query}, timeout=60)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                last_exc = exc
                print(f"  Échec : {exc}")
                if attempt < OVERPASS_MAX_RETRIES:
                    time.sleep(OVERPASS_RETRY_DELAY_S)
        print("  Endpoint épuisé, passage au suivant...\n")
    raise RuntimeError(f"Tous les endpoints Overpass ont échoué. Dernière erreur : {last_exc}")

def fetch_elements():
    print("Récupération Overpass (holes + tees)...")
    data = _overpass_post(OVERPASS_QUERY)
    elements = data.get("elements", [])
    print(f"  → {len(elements)} éléments reçus\n")
    return elements

# ─── Analyse géométrique ──────────────────────────────────────────────────────

def analyse(elements):
    """
    Retourne trois listes :
      plan_high  : [{id, type, ref, colors, calc, sc, err, conf}, ...]  → à appliquer
      plan_ambig : [{id, type, ref, colors, calc, sc_dists, err}, ...]  → ambigus
      plan_low   : [{id, type, ref, best, calc, err}, ...]              → faible confiance
    """
    holes = {}
    tees  = defaultdict(list)

    for el in elements:
        tags = el.get("tags", {})
        ref  = tags.get("ref")
        if not ref:
            continue
        golf = tags.get("golf")
        if golf == "hole" and el["type"] == "way" and "geometry" in el:
            if ref not in holes:
                holes[ref] = el["geometry"]
        elif golf == "tee":
            if el["type"] == "node":
                center = (el["lat"], el["lon"])
                osm_id = f"node/{el['id']}"
            else:
                center = centroid(el["geometry"])
                osm_id = f"way/{el['id']}"
            tees[ref].append({"id": osm_id, "raw_id": el["id"], "type": el["type"], "center": center})

    plan_high, plan_ambig, plan_low = [], [], []

    for ref, sc in sorted(SCORECARD.items(), key=lambda x: int(x[0])):
        if ref not in holes or ref not in tees:
            continue
        way_geom = holes[ref]

        for tee in tees[ref]:
            tlat, tlon   = tee["center"]
            remaining, _ = project_onto_way(tlat, tlon, way_geom)
            errors       = {c: abs(remaining - sc[c]) for c in COLORS}
            min_err      = min(errors.values())
            best_color   = min(errors, key=errors.get)
            best_dist    = sc[best_color]

            # Couleurs partageant la même distance scorecard (ex: black=white=311)
            same_group = [c for c in COLORS if sc[c] == best_dist]

            # Autres couleurs avec distance DIFFÉRENTE mais aussi dans HIGH_THR
            other_close = [c for c in COLORS
                           if c not in same_group
                           and errors[c] <= HIGH_THR
                           and abs(sc[c] - best_dist) <= TEE_SIZE]

            conf = "HIGH" if min_err <= HIGH_THR else ("MEDIUM" if min_err <= MED_THR else "LOW")

            base = {
                "id":     tee["id"],
                "raw_id": tee["raw_id"],
                "type":   tee["type"],
                "ref":    ref,
                "calc":   round(remaining),
                "err":    round(min_err),
            }

            if conf == "LOW":
                plan_low.append({**base, "best": best_color})
            elif other_close:
                plan_ambig.append({**base,
                    "colors":   same_group + other_close,
                    "sc_dists": {c: sc[c] for c in same_group + other_close},
                    "conf":     conf,
                })
            else:
                plan_high.append({**base,
                    "colors": same_group,
                    "sc":     best_dist,
                    "conf":   conf,
                })

    return plan_high, plan_ambig, plan_low

# ─── Affichage du plan ────────────────────────────────────────────────────────

def print_plan(plan_high, plan_ambig, plan_low):
    sep = "─" * 95

    print(f"\n{sep}")
    print("TABLEAU 1 — Tees à mettre à jour (HIGH / MEDIUM)")
    print(sep)
    print(f"{'Trou':>5}  {'OSM ID':>16}  {'Couleur(s)':>22}  {'Calculé':>8}  {'Carte':>6}  {'Écart':>6}  {'Conf':>7}")
    print(sep)
    for r in plan_high:
        colors_s = ";".join(r["colors"])
        print(f"{r['ref']:>5}  {r['id']:>16}  {colors_s:>22}  {r['calc']:>8}  {r['sc']:>6}  {r['err']:>6}  {r['conf']:>7}")
    print(f"\n  → {len(plan_high)} tee(s) à mettre à jour\n")

    print(f"{sep}")
    print("TABLEAU 2 — Cas ambigus (2 couleurs distinctes dans même zone) — nécessite --include-ambiguous")
    print(sep)
    if plan_ambig:
        print(f"{'Trou':>5}  {'OSM ID':>16}  {'Couleurs':>22}  {'Calculé':>8}  {'Distances carte':>22}  {'Écart':>6}")
        print(sep)
        for r in plan_ambig:
            colors_s = ";".join(r["colors"])
            dists_s  = "/".join(str(r["sc_dists"][c]) for c in r["colors"])
            print(f"{r['ref']:>5}  {r['id']:>16}  {colors_s:>22}  {r['calc']:>8}  {dists_s:>22}  {r['err']:>6}")
    else:
        print("  (aucun)")
    print()

    print(f"{sep}")
    print("TABLEAU 3 — Faible confiance (LOW) — non appliqués")
    print(sep)
    if plan_low:
        for r in plan_low:
            print(f"  Trou {r['ref']:>2}  {r['id']}  best={r['best']}  calc={r['calc']}m  err={r['err']}m")
    else:
        print("  (aucun)")
    print()

# ─── OSM API ──────────────────────────────────────────────────────────────────

def oauth2_get_token(client_id, client_secret):
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
        print(f"ERREUR token : {resp.text}")
        sys.exit(1)
    print("  → Token obtenu.\n")
    return token

def create_changeset(session):
    root = ET.Element("osm", version="0.6")
    cs   = ET.SubElement(root, "changeset")
    ET.SubElement(cs, "tag", k="comment",    v=CHANGESET_COMMENT)
    ET.SubElement(cs, "tag", k="created_by", v="GolfTracker/add_tee_color.py")
    xml = '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")
    resp = session.put(f"{OSM_API}/changeset/create",
                       data=xml.encode("utf-8"),
                       headers={"Content-Type": "text/xml"})
    resp.raise_for_status()
    cid = resp.text.strip()
    print(f"Changeset créé : {cid}")
    print(f"  https://www.openstreetmap.org/changeset/{cid}\n")
    return cid

def close_changeset(session, cid):
    session.put(f"{OSM_API}/changeset/{cid}/close")
    print(f"\nChangeset {cid} fermé.")

def apply_updates(session, plan, changeset_id, verbose):
    updated = already_ok = 0
    errors  = []
    total   = len(plan)

    for i, item in enumerate(plan, 1):
        elem_type = item["type"]
        elem_id   = item["raw_id"]
        colors    = item["colors"]
        tee_value = ";".join(colors)
        prefix    = f"  [{i:3d}/{total}] {item['id']}  (trou {item['ref']})"

        try:
            resp = session.get(f"{OSM_API}/{elem_type}/{elem_id}")
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            elem = root.find(elem_type)
            if elem is None:
                raise ValueError(f"<{elem_type}> introuvable dans le XML")

            existing = elem.find("tag[@k='golf:tee']")
            if existing is not None:
                if existing.get("v") == tee_value:
                    if verbose:
                        print(f"{prefix}  (déjà correct : golf:tee={tee_value})")
                    already_ok += 1
                    continue
                existing.set("v", tee_value)
            else:
                new_tag = ET.SubElement(elem, "tag")
                new_tag.set("k", "golf:tee")
                new_tag.set("v", tee_value)

            elem.set("changeset", changeset_id)
            xml_str = ET.tostring(root, encoding="unicode")
            session.put(f"{OSM_API}/{elem_type}/{elem_id}",
                        data=xml_str.encode("utf-8"),
                        headers={"Content-Type": "text/xml"}).raise_for_status()
            print(f"{prefix}  ✓  golf:tee={tee_value}")
            updated += 1
            time.sleep(PUT_DELAY_S)

        except Exception as exc:
            print(f"{prefix}  ERREUR : {exc}")
            errors.append((item["id"], str(exc)))

    return updated, already_ok, errors

# ─── Point d'entrée ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ajoute golf:tee=<couleur> sur les tees du Golf de la Bresse"
    )
    parser.add_argument("--dry-run",            action="store_true",
                        help="Prévisualise sans écrire sur OSM")
    parser.add_argument("--client-id",          help="Client ID OAuth 2 OSM")
    parser.add_argument("--client-secret",      help="Client Secret OAuth 2 OSM")
    parser.add_argument("--verbose",            action="store_true",
                        help="Affiche aussi les éléments déjà corrects")
    parser.add_argument("--include-ambiguous",  action="store_true",
                        help="Applique aussi les cas ambigus (tableau 2) avec golf:tee=couleur1;couleur2")
    args = parser.parse_args()

    if not args.dry_run and (not args.client_id or not args.client_secret):
        print("ERREUR : --client-id et --client-secret sont requis hors dry-run.")
        print("Crée une application sur : https://www.openstreetmap.org/oauth2/applications")
        sys.exit(1)

    # 1. Fetch
    elements = fetch_elements()

    # 2. Analyse
    plan_high, plan_ambig, plan_low = analyse(elements)

    # 3. Plan complet
    to_apply = list(plan_high)
    if args.include_ambiguous:
        to_apply += plan_ambig

    print_plan(plan_high, plan_ambig, plan_low)

    if not to_apply:
        print("Rien à appliquer.")
        return

    if args.dry_run:
        print(f"[DRY RUN] {len(to_apply)} modification(s) prévue(s). Aucune écriture OSM.")
        return

    # 4. Confirmation
    label = f"{len(plan_high)} HIGH/MEDIUM"
    if args.include_ambiguous and plan_ambig:
        label += f" + {len(plan_ambig)} ambigus"
    confirm = input(f"\nAppliquer {label} modification(s) sur OSM ? [oui/N] ").strip().lower()
    if confirm != "oui":
        print("Annulé.")
        return

    # 5. OAuth + apply
    token   = oauth2_get_token(args.client_id, args.client_secret)
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}"})

    cid = create_changeset(session)
    try:
        updated, already_ok, errors = apply_updates(session, to_apply, cid, args.verbose)
    finally:
        close_changeset(session, cid)

    print(f"\nRésumé :")
    print(f"  Mis à jour    : {updated}")
    print(f"  Déjà corrects : {already_ok}")
    print(f"  Erreurs       : {len(errors)}")
    if errors:
        print("\n  Détail des erreurs :")
        for osm_id, msg in errors:
            print(f"    {osm_id} : {msg}")

if __name__ == "__main__":
    main()
