#!/usr/bin/env bash
#
# Set or rotate the DARA-004 least-privilege role passwords (dara_app, dara_admin).
#
# This script contains NO secrets — it reads the passwords from your shell
# environment and applies them via ALTER ROLE. Safe to commit; the credentials
# never touch source control (the DARA-001 lesson).
#
# Usage (passwords transient in your shell, never written to a file):
#   export DIRECT_URL='postgresql://postgres.<ref>:<owner_pw>@<host>:5432/postgres'
#   export DARA_APP_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=@:#?')"
#   export DARA_ADMIN_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=@:#?')"
#   bash prisma/security/rotate-dara004-roles.sh
#
# Requires: psql, and DIRECT_URL pointing at the OWNER connection (only the owner
# can ALTER these roles). After running, update the connection strings in Vercel
# (all environments) + .env.local and redeploy — updating only one side is what
# caused the post-rotation 500s (BUILD_STATUS.md gap #9).
#
set -euo pipefail

: "${DIRECT_URL:?Set DIRECT_URL (owner connection) — only the owner can ALTER these roles}"
: "${DARA_APP_PASSWORD:?Set DARA_APP_PASSWORD in your shell (do not commit)}"
: "${DARA_ADMIN_PASSWORD:?Set DARA_ADMIN_PASSWORD in your shell (do not commit)}"

# psql :'var' quoting safely handles special characters in the password.
psql "$DIRECT_URL" \
  -v ON_ERROR_STOP=1 \
  -v app_pw="$DARA_APP_PASSWORD" \
  -v admin_pw="$DARA_ADMIN_PASSWORD" <<'SQL'
alter role dara_app   with login password :'app_pw';
alter role dara_admin with login password :'admin_pw';
SQL

echo "Roles updated. Next: set DATABASE_URL_APP / DATABASE_URL_ADMIN in Vercel (all envs)"
echo "+ .env.local to match, then redeploy."
