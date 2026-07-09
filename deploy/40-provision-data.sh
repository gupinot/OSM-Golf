#!/usr/bin/env bash
# Provisionne la couche données : APIs Firestore/Storage, base Firestore, bucket de
# données (géométries GeoJSON + images de scorecards) et droits IAM du compte de service
# d'exécution Cloud Run. Idempotent : réexécutable sans effet de bord.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"

PROJECT=""
LOCATION="${FIRESTORE_LOCATION:-eur3}"
BUCKET="${DATA_BUCKET:-}"
BUCKET_LOCATION="${BUCKET_LOCATION:-europe-west1}"
usage() { cat <<EOF
Usage: [DATA_BUCKET=nom-bucket] $0 --project PROJECT_ID \\
         [--location FIRESTORE_LOC] [--bucket NAME] [--bucket-location LOC]

Active les APIs Firestore/Storage, crée la base Firestore (--location, défaut eur3),
crée le bucket de données (--bucket ou \$DATA_BUCKET, défaut PROJECT-data ;
--bucket-location, défaut europe-west1) et accorde au compte de service compute
(exécution Cloud Run) les rôles datastore.user et storage.objectAdmin. Idempotent.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --project)         PROJECT="${2:-}"; shift 2;;
    --location)        LOCATION="${2:-}"; shift 2;;
    --bucket)          BUCKET="${2:-}"; shift 2;;
    --bucket-location) BUCKET_LOCATION="${2:-}"; shift 2;;
    -h|--help)         usage; exit 0;;
    *) die "argument inconnu: $1 (voir --help)";;
  esac
done
[ -n "$PROJECT" ] || { usage; die "--project requis"; }
require_cmd gcloud
BUCKET="${BUCKET:-${PROJECT}-data}"

gcloud services enable \
  firestore.googleapis.com \
  firebasestorage.googleapis.com \
  storage.googleapis.com \
  --project "$PROJECT"
echo "APIs données activées ✓"

# Base Firestore (mode natif). Créée seulement si absente.
if gcloud firestore databases describe --project "$PROJECT" >/dev/null 2>&1; then
  echo "· Base Firestore déjà présente → ignoré"
else
  gcloud firestore databases create --location="$LOCATION" --project "$PROJECT"
  echo "Base Firestore créée ($LOCATION) ✓"
fi

# Bucket de données (géométries + scorecards). Créé seulement si absent.
if gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1; then
  echo "· Bucket gs://${BUCKET} déjà présent → ignoré"
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project "$PROJECT" --location="$BUCKET_LOCATION"
  echo "Bucket gs://${BUCKET} créé ($BUCKET_LOCATION) ✓"
fi

# IAM : le compte de service compute (identité d'exécution Cloud Run) lit/écrit
# Firestore et les objets du bucket.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/datastore.user" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/storage.objectAdmin" >/dev/null
echo "Rôles datastore.user + storage.objectAdmin accordés à ${COMPUTE_SA} ✓"

echo "Provisioning données terminé. Bucket: gs://${BUCKET} — reporter dans DATA_BUCKET (deploy/.env)."
