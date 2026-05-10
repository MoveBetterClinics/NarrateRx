#!/usr/bin/env bash
# Manual backup of the shared narraterx Supabase Postgres DB.
# Run from repo root: npm run backup:db
# Output: ~/Backups/narraterx-supabase/narraterx-<UTC-timestamp>.sql.gz

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${HOME}/Backups/narraterx-supabase"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/narraterx-${TIMESTAMP}.sql"

if [ ! -f "${REPO_ROOT}/.env.local" ]; then
  echo "ERROR: ${REPO_ROOT}/.env.local not found. Need MULTITENANT_DATABASE_URL." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "${REPO_ROOT}/.env.local"
set +a

if [ -z "${MULTITENANT_DATABASE_URL:-}" ]; then
  echo "ERROR: MULTITENANT_DATABASE_URL not set in .env.local" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not installed. Run: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# Parse the connection URL into discrete components so a literal '@' or other
# special character in the password doesn't break URI parsing in pg_dump.
# We split on the LAST '@' since hosts cannot contain '@' but passwords can.
PARSED="$(node --input-type=module -e '
  const raw = process.env.MULTITENANT_DATABASE_URL;
  const stripped = raw.replace(/^postgres(ql)?:\/\//, "");
  const lastAt = stripped.lastIndexOf("@");
  if (lastAt < 0) { console.error("no @ in URL"); process.exit(1); }
  const auth = stripped.slice(0, lastAt);
  const hostPart = stripped.slice(lastAt + 1);
  const colon = auth.indexOf(":");
  const user = colon < 0 ? auth : auth.slice(0, colon);
  const pwd  = colon < 0 ? "" : auth.slice(colon + 1);
  const slash = hostPart.indexOf("/");
  const hostport = slash < 0 ? hostPart : hostPart.slice(0, slash);
  const dbAndQ  = slash < 0 ? "postgres" : hostPart.slice(slash + 1);
  const db = dbAndQ.split("?")[0] || "postgres";
  const [host, port = "5432"] = hostport.split(":");
  // Tab-delimit so passwords with spaces survive.
  process.stdout.write([host, port, decodeURIComponent(user), db, decodeURIComponent(pwd)].join("\t"));
')" || { echo "ERROR: failed to parse MULTITENANT_DATABASE_URL." >&2; exit 1; }

IFS=$'\t' read -r PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD <<< "${PARSED}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

echo "→ Dumping shared narraterx DB to ${OUT_FILE}.gz ..."
pg_dump \
  --no-owner --no-privileges --clean --if-exists \
  --exclude-schema='auth' \
  --exclude-schema='storage' \
  --exclude-schema='realtime' \
  --exclude-schema='supabase_functions' \
  --exclude-schema='vault' \
  --exclude-schema='extensions' \
  --exclude-schema='graphql' \
  --exclude-schema='graphql_public' \
  --exclude-schema='pgsodium' \
  --exclude-schema='pgsodium_masks' \
  --file="${OUT_FILE}"

unset PGPASSWORD

gzip "${OUT_FILE}"

echo "✓ Done."
echo ""
echo "Latest 5 backups:"
ls -lh "${BACKUP_DIR}" | tail -5
echo ""
echo "Reminder: copy this snapshot off-machine (1Password attachment, iCloud, external drive)."
echo "  cp \"${OUT_FILE}.gz\" ~/Library/Mobile\\ Documents/com~apple~CloudDocs/Backups/  # iCloud example"
