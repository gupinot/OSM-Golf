#!/usr/bin/env bash
# Déploie les règles de sécurité et index Firestore + les règles Storage via la CLI
# firebase (lit firebase.json à la racine du dépôt). Prérequis non scriptable :
# `firebase login` interactif effectué au préalable.
source "$(cd "$(dirname "$0")" && pwd)/_lib.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PROJECT=""
usage() { cat <<EOF
Usage: $0 --project PROJECT_ID

Déploie firestore.rules, firestore.indexes.json et storage.rules
(firebase deploy --only firestore,storage). Prérequis : firebase CLI installée et
\`firebase login\` effectué (étape interactive, non scriptable).
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
require_cmd firebase

( cd "$ROOT" && firebase deploy \
    --only firestore:rules,firestore:indexes,storage \
    --project "$PROJECT" )
echo "Règles/index Firestore + règles Storage déployés ✓"
