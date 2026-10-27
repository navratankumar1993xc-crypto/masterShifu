#!/usr/bin/env bash
# =============================================================================
# WEB_TS Panel — reset + create the PostgreSQL database on Ubuntu.
#
#   1. Reads DB_* from ../.env
#   2. DROPs the database DB_NAME (kicks out open connections first)
#      --all  : drops EVERY non-system database on the server instead
#   3. CREATEs DB_NAME fresh
#   4. Applies database/schema.sql (all tables, indexes, settings, admin user)
#
# Usage (from the project root):
#   bash database/setup_db.sh          # asks for confirmation
#   bash database/setup_db.sh -y       # no prompt
#   bash database/setup_db.sh --all -y # wipe all user databases, then create
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
SCHEMA_FILE="$SCRIPT_DIR/schema.sql"

ASSUME_YES=0
DROP_ALL=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --all)    DROP_ALL=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

[ -f "$ENV_FILE" ]    || { echo "ERROR: .env not found at $ENV_FILE" >&2; exit 1; }
[ -f "$SCHEMA_FILE" ] || { echo "ERROR: schema.sql not found at $SCHEMA_FILE" >&2; exit 1; }
command -v psql >/dev/null || { echo "ERROR: psql not installed (sudo apt install postgresql-client)" >&2; exit 1; }

# Read KEY=value without sourcing (password may contain @, $, etc.)
env_get() {
  grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- \
    | tr -d '\r' | sed -E 's/^["'\'']//; s/["'\'']$//'
}

DB_HOST="$(env_get DB_HOST)"; DB_HOST="${DB_HOST:-localhost}"
DB_PORT="$(env_get DB_PORT)"; DB_PORT="${DB_PORT:-5432}"
DB_NAME="$(env_get DB_NAME)"; DB_NAME="${DB_NAME:-web_ts_panel}"
DB_USER="$(env_get DB_USER)"; DB_USER="${DB_USER:-postgres}"
DB_PASS="$(env_get DB_PASS)"

export PGPASSWORD="$DB_PASS"
PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -v ON_ERROR_STOP=1 -X -q)

echo "Host: $DB_HOST:$DB_PORT   User: $DB_USER   Database: $DB_NAME"
"${PSQL[@]}" -d postgres -c "SELECT 1" >/dev/null \
  || { echo "ERROR: cannot connect to PostgreSQL with the .env credentials" >&2; exit 1; }

if [ "$DROP_ALL" -eq 1 ]; then
  TARGETS="$("${PSQL[@]}" -d postgres -At -c \
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY 1")"
else
  TARGETS="$DB_NAME"
fi

echo
echo "The following database(s) will be PERMANENTLY DROPPED:"
echo "${TARGETS:-  (none)}" | sed 's/^/  - /'
echo "Then '$DB_NAME' will be created from schema.sql."
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Type YES to continue: " answer
  [ "$answer" = "YES" ] || { echo "Aborted."; exit 1; }
fi

# ── 1. drop ──────────────────────────────────────────────────────────────────
while IFS= read -r db; do
  [ -n "$db" ] || continue
  echo "[drop] $db"
  "${PSQL[@]}" -d postgres -v db="$db" <<'SQL'
\o /dev/null
SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
 WHERE datname = :'db' AND pid <> pg_backend_pid();
\o
DROP DATABASE IF EXISTS :"db";
SQL
done <<< "$TARGETS"

# ── 2. create ────────────────────────────────────────────────────────────────
echo "[create] $DB_NAME"
"${PSQL[@]}" -d postgres -v db="$DB_NAME" -v owner="$DB_USER" <<'SQL'
CREATE DATABASE :"db" OWNER :"owner" ENCODING 'UTF8' TEMPLATE template0;
SQL

# ── 3. migrate ───────────────────────────────────────────────────────────────
echo "[migrate] $SCHEMA_FILE"
"${PSQL[@]}" -d "$DB_NAME" -f "$SCHEMA_FILE"

echo
"${PSQL[@]}" -d "$DB_NAME" -c "\dt"
echo "Done. Default login: admin@webts.com / admin123 — change it after first login."
