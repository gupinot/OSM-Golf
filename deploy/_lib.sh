# Helpers partagés par les scripts de déploiement (fichier sourcé, sans shebang).
set -euo pipefail

# Charge automatiquement deploy/.env (variables de déploiement, non versionné) s'il existe.
# set -a → toutes les variables assignées sont exportées (visibles par npm/gcloud/firebase).
_ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env"
if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
fi

die() { echo "Erreur: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "commande requise absente: $1"; }

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "variable d'environnement requise: $name"
}
