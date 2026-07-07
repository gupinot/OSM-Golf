#!/usr/bin/env bash
# Build le frontend (config Firebase web via variables VITE_FIREBASE_*) et déploie
# sur Firebase Hosting.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PROJECT=""
usage() { cat <<EOF
Usage: VITE_FIREBASE_API_KEY=... VITE_FIREBASE_AUTH_DOMAIN=... \\
       VITE_FIREBASE_PROJECT_ID=... VITE_FIREBASE_APP_ID=... \\
       $0 --project PROJECT_ID

Build le frontend avec la config Firebase web (variables VITE_FIREBASE_*, publiques)
puis déploie sur Firebase Hosting. Sans ces variables, l'appli déployée serait ouverte
(auth désactivée) — elles sont donc requises.
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
require_cmd npm; require_cmd firebase
require_env VITE_FIREBASE_API_KEY
require_env VITE_FIREBASE_AUTH_DOMAIN
require_env VITE_FIREBASE_PROJECT_ID
require_env VITE_FIREBASE_APP_ID

export VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID
npm --prefix "$ROOT/frontend" run build
firebase deploy --only hosting --project "$PROJECT"
echo "Frontend déployé sur Hosting (projet $PROJECT) ✓"
