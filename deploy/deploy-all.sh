#!/usr/bin/env bash
# Orchestration complète : enable APIs → secrets → backend → frontend.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"
DIR="$(cd "$(dirname "$0")" && pwd)"

PROJECT=""; REGION="europe-west1"; SERVICE="osm-golf-api"
usage() { cat <<EOF
Usage: <secrets + VITE_FIREBASE_* en variables d'env> \\
       $0 --project PROJECT_ID [--region REGION] [--service NAME]

Enchaîne 00-enable-apis, 40-provision-data, 10-secrets, 20-deploy-backend,
45-deploy-firestore, 30-deploy-frontend.
Variables d'environnement requises : voir 10-secrets.sh --help et 30-deploy-frontend.sh --help.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2;;
    --region)  REGION="${2:-}"; shift 2;;
    --service) SERVICE="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "argument inconnu: $1 (voir --help)";;
  esac
done
[ -n "$PROJECT" ] || { usage; die "--project requis"; }

"$DIR/00-enable-apis.sh" --project "$PROJECT"
"$DIR/40-provision-data.sh" --project "$PROJECT"
"$DIR/10-secrets.sh" --project "$PROJECT"
"$DIR/20-deploy-backend.sh" --project "$PROJECT" --region "$REGION" --service "$SERVICE"
"$DIR/45-deploy-firestore.sh" --project "$PROJECT"
"$DIR/30-deploy-frontend.sh" --project "$PROJECT"
echo "Déploiement complet ✓"
