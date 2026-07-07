#!/usr/bin/env bash
# Active les APIs GCP nécessaires et définit le projet gcloud courant.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"

PROJECT=""
usage() { cat <<EOF
Usage: $0 --project PROJECT_ID

Active les APIs GCP requises (Cloud Run, Cloud Build, Secret Manager, Artifact
Registry) et positionne le projet gcloud par défaut.
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

gcloud config set project "$PROJECT"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT"
echo "APIs activées pour $PROJECT ✓"

# Le déploiement Cloud Run « from source » utilise le compte de service compute par
# défaut comme identité de build. Sur les projets récents, il n'a pas les droits de
# build ni d'accès au bucket des sources → on lui accorde le rôle Cloud Build Service
# Account (build + lecture source + écriture Artifact Registry + logs).
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/cloudbuild.builds.builder" >/dev/null
echo "Rôle cloudbuild.builds.builder accordé à ${COMPUTE_SA} ✓"
