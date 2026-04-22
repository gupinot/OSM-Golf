#!/bin/bash
# Golf de la Bresse — Enrichissement OSM via JOSM RemoteControl
# Script généré automatiquement par GolfMind Pipeline — 2026-03-31
# Parcours OSM : way/190706755 — Golf de la Bresse
# Enrichissement : handicap + dist:black/white/yellow/blue/red sur 18 holes
#                  par=4 ajouté sur trou 14 (tag manquant)
# Greens : déjà enrichis (ref 1-18 présents) — aucune action nécessaire

BBOX="bottom=46.126&top=46.156&left=5.092&right=5.122"
BASE="http://localhost:8111/load_and_zoom?${BBOX}"

echo "=== Enrichissement Golf de la Bresse — 18 trous ==="
echo "Vérification JOSM RemoteControl..."
curl -s "http://localhost:8111/version" > /dev/null || {
  echo "ERREUR: JOSM RemoteControl non disponible."
  echo "→ Ouvrir JOSM, puis : Préférences → Contrôle à distance → Activer"
  exit 1
}
echo "OK — JOSM RemoteControl actif"
echo ""

# -----------------------------------------------------------------------
# HOLES — Ajout : handicap + dist:black/white/yellow/blue/red
# -----------------------------------------------------------------------

echo "[Trou 1]  way/440880577 — par=4, hcp=18"
curl -s "${BASE}&select=way440880577&addtags=handicap%3D18%7Cdist%3Ablack%3D311%7Cdist%3Awhite%3D311%7Cdist%3Ayellow%3D266%7Cdist%3Ablue%3D227%7Cdist%3Ared%3D227" > /dev/null
sleep 1

echo "[Trou 2]  way/440880578 — par=4, hcp=16"
curl -s "${BASE}&select=way440880578&addtags=handicap%3D16%7Cdist%3Ablack%3D285%7Cdist%3Awhite%3D285%7Cdist%3Ayellow%3D244%7Cdist%3Ablue%3D212%7Cdist%3Ared%3D212" > /dev/null
sleep 1

echo "[Trou 3]  way/440880579 — par=5, hcp=14"
curl -s "${BASE}&select=way440880579&addtags=handicap%3D14%7Cdist%3Ablack%3D459%7Cdist%3Awhite%3D459%7Cdist%3Ayellow%3D439%7Cdist%3Ablue%3D390%7Cdist%3Ared%3D383" > /dev/null
sleep 1

echo "[Trou 4]  way/440880580 — par=4, hcp=9"
curl -s "${BASE}&select=way440880580&addtags=handicap%3D9%7Cdist%3Ablack%3D366%7Cdist%3Awhite%3D366%7Cdist%3Ayellow%3D331%7Cdist%3Ablue%3D308%7Cdist%3Ared%3D308" > /dev/null
sleep 1

echo "[Trou 5]  way/440880581 — par=3, hcp=10"
curl -s "${BASE}&select=way440880581&addtags=handicap%3D10%7Cdist%3Ablack%3D158%7Cdist%3Awhite%3D158%7Cdist%3Ayellow%3D135%7Cdist%3Ablue%3D115%7Cdist%3Ared%3D107" > /dev/null
sleep 1

echo "[Trou 6]  way/440880582 — par=4, hcp=1"
curl -s "${BASE}&select=way440880582&addtags=handicap%3D1%7Cdist%3Ablack%3D405%7Cdist%3Awhite%3D405%7Cdist%3Ayellow%3D360%7Cdist%3Ablue%3D360%7Cdist%3Ared%3D324" > /dev/null
sleep 1

echo "[Trou 7]  way/440880583 — par=4, hcp=7"
curl -s "${BASE}&select=way440880583&addtags=handicap%3D7%7Cdist%3Ablack%3D360%7Cdist%3Awhite%3D360%7Cdist%3Ayellow%3D317%7Cdist%3Ablue%3D284%7Cdist%3Ared%3D275" > /dev/null
sleep 1

echo "[Trou 8]  way/440880584 — par=3, hcp=5"
curl -s "${BASE}&select=way440880584&addtags=handicap%3D5%7Cdist%3Ablack%3D194%7Cdist%3Awhite%3D194%7Cdist%3Ayellow%3D184%7Cdist%3Ablue%3D161%7Cdist%3Ared%3D125" > /dev/null
sleep 1

echo "[Trou 9]  way/440880585 — par=5, hcp=3"
curl -s "${BASE}&select=way440880585&addtags=handicap%3D3%7Cdist%3Ablack%3D502%7Cdist%3Awhite%3D502%7Cdist%3Ayellow%3D454%7Cdist%3Ablue%3D408%7Cdist%3Ared%3D400" > /dev/null
sleep 1

echo "[Trou 10] way/440880568 — par=4, hcp=6"
curl -s "${BASE}&select=way440880568&addtags=handicap%3D6%7Cdist%3Ablack%3D369%7Cdist%3Awhite%3D369%7Cdist%3Ayellow%3D341%7Cdist%3Ablue%3D318%7Cdist%3Ared%3D295" > /dev/null
sleep 1

echo "[Trou 11] way/440880569 — par=4, hcp=13"
curl -s "${BASE}&select=way440880569&addtags=handicap%3D13%7Cdist%3Ablack%3D271%7Cdist%3Awhite%3D271%7Cdist%3Ayellow%3D264%7Cdist%3Ablue%3D259%7Cdist%3Ared%3D199" > /dev/null
sleep 1

echo "[Trou 12] way/440880570 — par=3, hcp=11"
curl -s "${BASE}&select=way440880570&addtags=handicap%3D11%7Cdist%3Ablack%3D153%7Cdist%3Awhite%3D153%7Cdist%3Ayellow%3D134%7Cdist%3Ablue%3D107%7Cdist%3Ared%3D102" > /dev/null
sleep 1

echo "[Trou 13] way/440880571 — par=5, hcp=12"
curl -s "${BASE}&select=way440880571&addtags=handicap%3D12%7Cdist%3Ablack%3D448%7Cdist%3Awhite%3D448%7Cdist%3Ayellow%3D412%7Cdist%3Ablue%3D378%7Cdist%3Ared%3D378" > /dev/null
sleep 1

echo "[Trou 14] way/440880572 — par=4 (manquant!), hcp=4"
curl -s "${BASE}&select=way440880572&addtags=par%3D4%7Chandicap%3D4%7Cdist%3Ablack%3D379%7Cdist%3Awhite%3D379%7Cdist%3Ayellow%3D351%7Cdist%3Ablue%3D313%7Cdist%3Ared%3D292" > /dev/null
sleep 1

echo "[Trou 15] way/440880573 — par=4, hcp=17"
curl -s "${BASE}&select=way440880573&addtags=handicap%3D17%7Cdist%3Ablack%3D307%7Cdist%3Awhite%3D307%7Cdist%3Ayellow%3D292%7Cdist%3Ablue%3D260%7Cdist%3Ared%3D231" > /dev/null
sleep 1

echo "[Trou 16] way/440880574 — par=3, hcp=15"
curl -s "${BASE}&select=way440880574&addtags=handicap%3D15%7Cdist%3Ablack%3D190%7Cdist%3Awhite%3D190%7Cdist%3Ayellow%3D179%7Cdist%3Ablue%3D172%7Cdist%3Ared%3D139" > /dev/null
sleep 1

echo "[Trou 17] way/440880575 — par=4, hcp=2"
curl -s "${BASE}&select=way440880575&addtags=handicap%3D2%7Cdist%3Ablack%3D372%7Cdist%3Awhite%3D372%7Cdist%3Ayellow%3D339%7Cdist%3Ablue%3D298%7Cdist%3Ared%3D298" > /dev/null
sleep 1

echo "[Trou 18] way/440880576 — par=5, hcp=8"
curl -s "${BASE}&select=way440880576&addtags=handicap%3D8%7Cdist%3Ablack%3D480%7Cdist%3Awhite%3D480%7Cdist%3Ayellow%3D457%7Cdist%3Ablue%3D415%7Cdist%3Ared%3D363" > /dev/null
sleep 1

echo ""
echo "=== Terminé — 18 trous enrichis ==="
echo ""
echo "Étapes suivantes dans JOSM :"
echo "  1. Vérifier quelques trous (panneau Attributs/Appartenance)"
echo "  2. Fichier → Envoyer les données"
echo "  3. Commentaire : Golf scorecard enrichment — Golf de la Bresse — 18 holes (handicap, dist par tee)"
echo "  4. Source     : scorecard officielle golfdelabresse.fr"
