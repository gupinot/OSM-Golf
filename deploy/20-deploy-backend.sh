#!/usr/bin/env bash
# Déploie le backend Express sur Cloud Run (build à distance via Cloud Build depuis
# backend/Dockerfile). Secrets injectés depuis Secret Manager.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PROJECT=""; REGION="europe-west1"; SERVICE="osm-golf-api"
usage() { cat <<EOF
Usage: $0 --project PROJECT_ID [--region REGION] [--service NAME]

Défauts : --region europe-west1, --service osm-golf-api.
⚠ Ces valeurs doivent correspondre au rewrite Cloud Run de firebase.json.
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
require_cmd gcloud
require_env GEMINI_API_KEY
require_env AUTHORIZED_EMAILS

# Liste --set-secrets construite selon les secrets réellement fournis (variables non
# vides) — cohérent avec 10-secrets.sh. OSM_CLIENT_ID/SECRET restent optionnels
# (nécessaires seulement pour l'écriture OSM).
SECRETS=""
add_secret() { local n="$1"; [ -n "${!n:-}" ] && SECRETS="${SECRETS:+$SECRETS,}$n=$n:latest"; }
add_secret GEMINI_API_KEY
add_secret OSM_CLIENT_ID
add_secret OSM_CLIENT_SECRET
add_secret AUTHORIZED_EMAILS

# Variables d'environnement : projet Firebase + bucket de données (si provisionné).
ENV_VARS="FIREBASE_PROJECT_ID=${PROJECT}"
[ -n "${DATA_BUCKET:-}" ] && ENV_VARS="${ENV_VARS},DATA_BUCKET=${DATA_BUCKET}"

gcloud run deploy "$SERVICE" \
  --source "$ROOT/backend" \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRETS"
echo "Backend déployé : service $SERVICE ($REGION) ✓"
