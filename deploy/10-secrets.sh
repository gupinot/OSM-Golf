#!/usr/bin/env bash
# Crée/met à jour les secrets applicatifs dans Secret Manager. Aucune valeur en dur :
# les valeurs proviennent de variables d'environnement. Accorde ensuite au compte de
# service d'exécution Cloud Run le droit de lire les secrets.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"

PROJECT=""
usage() { cat <<EOF
Usage: GEMINI_API_KEY=... OSM_CLIENT_ID=... OSM_CLIENT_SECRET=... AUTHORIZED_EMAILS=... \\
       $0 --project PROJECT_ID

Crée ou met à jour les secrets Secret Manager depuis les variables d'environnement :
  GEMINI_API_KEY, OSM_CLIENT_ID, OSM_CLIENT_SECRET, AUTHORIZED_EMAILS
Une variable vide → le secret correspondant est ignoré. Le rôle secretAccessor est
ensuite accordé au compte de service Cloud Run par défaut (compute).
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "argument inconnu: $1 (voir --help)";;
  esac
done
[ -n "$PROJECT" ] || { usage; die "--project requis"; }
require_cmd gcloud

upsert_secret() {
  local name="$1" value="${2:-}"
  if [ -z "$value" ]; then echo "· $name : variable vide → ignoré"; return; fi
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT" >/dev/null
    echo "· $name : nouvelle version ajoutée"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic --project "$PROJECT" >/dev/null
    echo "· $name : créé"
  fi
}

upsert_secret GEMINI_API_KEY    "${GEMINI_API_KEY:-}"
upsert_secret OSM_CLIENT_ID     "${OSM_CLIENT_ID:-}"
upsert_secret OSM_CLIENT_SECRET "${OSM_CLIENT_SECRET:-}"
upsert_secret AUTHORIZED_EMAILS "${AUTHORIZED_EMAILS:-}"

# Compte de service d'exécution Cloud Run par défaut (compute) → lecture des secrets.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null
echo "Rôle secretAccessor accordé à ${RUNTIME_SA} ✓"
